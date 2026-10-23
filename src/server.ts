// Web process: the JSON API for the screens and the built screens themselves (web/dist).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";
import { loadDescription, loadState } from "./api/state.js";
import { tryNow } from "./api/sources-health.js";
import { BadRequest, NotFound, setStatus, setWatch, setWebsite, updatePrefs } from "./api/actions.js";

const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = path.resolve(process.cwd(), "web/dist");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json",
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new BadRequest("body too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadRequest("body is not JSON");
  }
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = req.method ?? "GET";
  if (method === "GET" && parts[1] === "state") return send(res, 200, await loadState());
  if (method === "GET" && parts[1] === "jobs" && parts[3] === "description") {
    const d = await loadDescription(Number(parts[2]));
    return d ? send(res, 200, d) : send(res, 404, { error: "not found" });
  }
  if (method === "POST" && parts[1] === "jobs" && parts[3] === "status") {
    const body = await readBody(req);
    const note = body.note === undefined ? undefined : body.note === null ? null : String(body.note).slice(0, 500);
    await setStatus(Number(parts[2]), String(body.status), note);
    return send(res, 200, { ok: true });
  }
  if (method === "POST" && parts[1] === "companies" && parts[2] === "watch") {
    const body = await readBody(req);
    await setWatch(String(body.name ?? ""), Boolean(body.watch));
    return send(res, 200, { ok: true });
  }
  if (method === "POST" && parts[1] === "companies" && parts[2] === "website") {
    const body = await readBody(req);
    await setWebsite(String(body.name ?? ""), String(body.website ?? ""));
    return send(res, 200, { ok: true });
  }
  if (method === "PUT" && parts[1] === "prefs") return send(res, 200, await updatePrefs(await readBody(req)));
  if (method === "POST" && parts[1] === "sources" && parts[3] === "check") return send(res, 200, await tryNow(parts[2]));
  send(res, 404, { error: "not found" });
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(STATIC_DIR, safe);
  if (!file.startsWith(STATIC_DIR)) file = path.join(STATIC_DIR, "index.html");
  try {
    if (!(await stat(file)).isFile()) file = path.join(STATIC_DIR, "index.html");
  } catch {
    file = path.join(STATIC_DIR, "index.html");
  }
  const isAsset = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "cache-control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(await readFile(file));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/health") {
      // Down when the crawler has not finished any task for six hours: the status page then shows it.
      const { rows } = await pool.query<{ last: Date | null }>("SELECT max(last_run_at) AS last FROM crawl_queue");
      const last = rows[0].last;
      const ok = Boolean(last && Date.now() - last.getTime() < 6 * 3600_000);
      return send(res, ok ? 200 : 503, { ok, lastRun: last });
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    await serveStatic(res, url.pathname);
  } catch (err) {
    if (err instanceof BadRequest) return send(res, 400, { error: err.message });
    if (err instanceof NotFound) return send(res, 404, { error: err.message });
    console.error(err);
    send(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, () => console.log(`web listening on ${PORT}`));
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => server.close(() => void pool.end()));
