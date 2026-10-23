// Outbound HTTP for every source: one User-Agent, a timeout, and refusals turned into HostRefusedError.
import { config } from "./config.js";
import { HostRefusedError } from "./handlers/index.js";

export type FetchOptions = { method?: string; headers?: Record<string, string>; body?: string; browserLike?: boolean };

// Some sources only answer a browser User-Agent; the contact address stays in the From header.
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    body: opts.body,
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "user-agent": opts.browserLike ? BROWSER_UA : config.userAgent,
      from: "contact@docaohieu.com",
      "accept-language": "en-US,en;q=0.9,vi;q=0.8",
      ...opts.headers,
    },
  });
  if (res.status === 429 || res.status === 403 || res.status === 999) {
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new HostRefusedError(res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
  }
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  return JSON.parse(await fetchText(url, { ...opts, headers: { accept: "application/json", ...opts.headers } })) as T;
}
