// robots.txt for company sites: fetched once per host per week, only the "*" group is honoured.
import { pool } from "./db.js";
import { config } from "./config.js";

const WEEK_MS = 7 * 86_400_000;

// Disallow prefixes for user-agent "*" (Allow lines and wildcards are not needed for career pages).
// Consecutive User-agent lines form one group; the rules after them apply to every agent in it.
export function disallowed(robots: string): string[] {
  const out: string[] = [];
  let agents: string[] = [];
  let readingAgents = false;
  for (const raw of robots.split(/\r?\n/)) {
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(raw.replace(/#.*/, "").trim());
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!readingAgents) agents = [];
      agents.push(value.toLowerCase());
      readingAgents = true;
    } else {
      readingAgents = false;
      if (field === "disallow" && value && agents.includes("*")) out.push(value);
    }
  }
  return out;
}

export function allowedBy(robots: string, path: string): boolean {
  return !disallowed(robots).some((prefix) => path.startsWith(prefix));
}

export async function robotsAllow(url: string): Promise<boolean> {
  const u = new URL(url);
  const { rows } = await pool.query<{ robots_txt: string | null; robots_fetched_at: Date | null }>(
    "SELECT robots_txt, robots_fetched_at FROM hosts WHERE host = $1",
    [u.host],
  );
  let robots = rows[0]?.robots_txt ?? null;
  if (!rows[0]?.robots_fetched_at || Date.now() - rows[0].robots_fetched_at.getTime() > WEEK_MS) {
    try {
      const res = await fetch(`${u.origin}/robots.txt`, { headers: { "user-agent": config.userAgent }, signal: AbortSignal.timeout(15_000) });
      robots = res.ok ? (await res.text()).slice(0, 100_000) : "";
    } catch {
      robots = "";
    }
    await pool.query(
      `INSERT INTO hosts (host, robots_txt, robots_fetched_at) VALUES ($1, $2, now())
       ON CONFLICT (host) DO UPDATE SET robots_txt = EXCLUDED.robots_txt, robots_fetched_at = now()`,
      [u.host, robots],
    );
  }
  return allowedBy(robots ?? "", u.pathname);
}
