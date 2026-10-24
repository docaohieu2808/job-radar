// robots.txt for company sites: fetched once per host per week, only the "*" group is honoured.
import { pool } from "./db.js";
import { config } from "./config.js";
import { fetchRobotsTxt, readCapped } from "./http.js";

const WEEK_MS = 7 * 86_400_000;

// Allow and Disallow rules of the "*" group. Consecutive User-agent lines form one group; the rules after them
// apply to every agent in it.
export function rules(robots: string): { allow: boolean; pattern: string }[] {
  const out: { allow: boolean; pattern: string }[] = [];
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
      if ((field === "disallow" || field === "allow") && value && agents.includes("*")) out.push({ allow: field === "allow", pattern: value });
    }
  }
  return out;
}

export function disallowed(robots: string): string[] {
  return rules(robots).filter((r) => !r.allow).map((r) => r.pattern);
}

// "*" matches anything and a trailing "$" anchors the end, as in Google's robots.txt rules.
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

// The longest matching rule wins; on a tie Allow wins. No matching rule means allowed.
export function allowedBy(robots: string, path: string): boolean {
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules(robots)) {
    if (!matches(r.pattern, path)) continue;
    const len = r.pattern.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return best ? best.allow : true;
}

export async function robotsAllow(url: string): Promise<boolean> {
  const u = new URL(url);
  const { rows } = await pool.query<{ robots_txt: string | null; robots_fetched_at: Date | null }>(
    "SELECT robots_txt, robots_fetched_at FROM hosts WHERE host = $1",
    [u.host],
  );
  let robots = rows[0]?.robots_txt ?? null;
  if (!rows[0]?.robots_fetched_at || Date.now() - rows[0].robots_fetched_at.getTime() > WEEK_MS) {
    // 4xx: there is no robots.txt, everything is allowed. 5xx or no answer: treat the site as closed for now and
    // ask again in an hour, rather than crawling it freely for a week.
    let fetchedAt = new Date();
    try {
      const res = await fetchRobotsTxt(`${u.origin}/robots.txt`, { "user-agent": config.userAgent });
      // Read through the size cap: an oversized robots.txt must not be buffered whole (it fails closed below).
      if (res.ok) robots = (await readCapped(res, `${u.origin}/robots.txt`)).slice(0, 100_000);
      else if (res.status < 500) robots = "";
      else throw new Error(`robots.txt answered ${res.status}`);
    } catch {
      robots = "User-agent: *\nDisallow: /";
      fetchedAt = new Date(Date.now() - WEEK_MS + 3_600_000);
    }
    await pool.query(
      `INSERT INTO hosts (host, robots_txt, robots_fetched_at) VALUES ($1, $2, $3)
       ON CONFLICT (host) DO UPDATE SET robots_txt = EXCLUDED.robots_txt, robots_fetched_at = EXCLUDED.robots_fetched_at`,
      [u.host, robots, fetchedAt],
    );
  }
  return allowedBy(robots ?? "", u.pathname);
}
