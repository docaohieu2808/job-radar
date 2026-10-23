// Whether each source is working, for the Sources screen and the sidebar line. Derived from the crawl queue:
// a paused host is Blocked, a task that failed and is being retried (or gave up today) is Degraded.
import { pool } from "../db.js";
import { clearRefusals, complete, deferTask, fail, pauseHost, type Task } from "../queue.js";
import { HostRefusedError } from "../handlers/index.js";
import { sourceHandlers } from "../sources/index.js";
import type { SourceHealth, Usage } from "./view-types.js";

const SOURCES = [
  { id: "linkedin", name: "LinkedIn", host: "www.linkedin.com", note: "one request every 5 minutes" },
  { id: "itviec", name: "ITviec", host: "itviec.com", note: "salary hidden without sign-in" },
  { id: "topdev", name: "TopDev", host: "api.topdev.vn", note: "salary hidden without sign-in" },
  { id: "vietnamworks", name: "VietnamWorks", host: "ms.vietnamworks.com", note: "" },
];

export const LINKEDIN_DAILY_LIMIT = 100;

const time = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

// Turns the stored error into a sentence for the screen.
function explain(name: string, error: string, pausedUntil: Date | null): { error: string; detail: string } {
  const refused = /refused with (\d+)/.exec(error);
  if (refused) {
    const code = refused[1];
    const why = code === "429" ? "too many requests" : "access refused";
    return {
      error: `${name} answered ${code} (${why}).`,
      detail: pausedUntil ? `Paused until ${time(pausedUntil)}, then checked again automatically. Try now checks whether it answers again.` : "Retrying with a longer wait.",
    };
  }
  if (/-> (\d+)/.test(error)) return { error: `${name} returned an error page (${/-> (\d+)/.exec(error)![1]}).`, detail: "Retrying with a longer wait." };
  if (/timeout|aborted/i.test(error)) return { error: `${name} did not answer within 30 seconds.`, detail: "Retrying with a longer wait." };
  return { error: `${name} could not be read: ${error}`, detail: "The page layout may have changed." };
}

export async function sourceHealth(): Promise<{ sources: SourceHealth[]; usage: Usage }> {
  const sources: SourceHealth[] = [];
  for (const s of SOURCES) {
    const { rows } = await pool.query<{
      last_run: Date | null; errors: string; last_error: string | null; blocked_until: Date | null; seen: string;
    }>(
      `SELECT (SELECT max(last_run_at) FROM crawl_queue WHERE kind LIKE $1) AS last_run,
              (SELECT count(*) FROM crawl_queue WHERE kind LIKE $1 AND last_error IS NOT NULL
                  AND (done_at IS NULL OR last_run_at > now() - interval '1 day')) AS errors,
              (SELECT last_error FROM crawl_queue WHERE kind LIKE $1 AND last_error IS NOT NULL ORDER BY last_run_at DESC NULLS LAST LIMIT 1) AS last_error,
              (SELECT blocked_until FROM hosts WHERE host = $2 AND blocked_until > now()) AS blocked_until,
              (SELECT count(*) FROM job_sources WHERE source = $3 AND last_seen_at > now() - interval '1 day') AS seen`,
      [`${s.id}-%`, s.host, s.id],
    );
    const r = rows[0];
    const errors = Number(r.errors);
    const status = r.blocked_until ? "Blocked" : errors > 0 ? "Degraded" : "Healthy";
    const explained = r.last_error && status !== "Healthy" ? explain(s.name, r.last_error, r.blocked_until) : null;
    sources.push({
      id: s.id,
      name: s.name,
      kind: "Job board",
      note: s.note,
      status,
      lastRun: r.last_run?.toISOString() ?? null,
      seen24h: Number(r.seen),
      errors,
      error: explained?.error ?? null,
      errorDetail: explained?.detail ?? null,
      pausedUntil: r.blocked_until?.toISOString() ?? null,
    });
  }

  const { rows } = await pool.query<{ pages: string | null; linkedin: string; last: Date | null }>(
    `SELECT (SELECT sum(fetched) FROM crawl_runs WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS pages,
            (SELECT count(*) FROM crawl_queue WHERE kind = 'linkedin-posting' AND created_at > date_trunc('day', now())) AS linkedin,
            (SELECT max(last_run_at) FROM crawl_queue) AS last`,
  );
  const u = rows[0];
  return {
    sources,
    usage: { pagesToday: Number(u.pages ?? 0), linkedinToday: Number(u.linkedin), linkedinLimit: LINKEDIN_DAILY_LIMIT, lastChecked: u.last?.toISOString() ?? null },
  };
}

export type TryResult = { ok: boolean; pausedUntil: string | null; message: string };

// "Try now" / "Check now": runs one of the source's searches immediately, outside the queue order.
// If the host answers, its pause is lifted and the other searches become due; if it refuses again,
// the pause doubles as it would for the crawler.
export async function tryNow(sourceId: string): Promise<TryResult> {
  const s = SOURCES.find((x) => x.id === sourceId);
  if (!s) throw new Error(`unknown source ${sourceId}`);
  const kind = `${s.id}-search`;
  const { rows } = await pool.query<Task>(
    `UPDATE crawl_queue SET locked_at = now(), attempts = attempts + 1
      WHERE id = (SELECT id FROM crawl_queue WHERE kind = $1 AND done_at IS NULL AND locked_at IS NULL ORDER BY priority LIMIT 1)
      RETURNING id, kind, url, host, payload, attempts`,
    [kind],
  );
  const task = rows[0];
  if (!task) return { ok: false, pausedUntil: null, message: `${s.name} is being checked right now` };
  // This request counts toward the host's politeness clock like any crawler request.
  await pool.query("UPDATE hosts SET next_allowed_at = now() + make_interval(secs => min_interval_s) WHERE host = $1", [task.host]);
  try {
    const result = await sourceHandlers[kind](task);
    await complete(task.id, result.recrawlAfterSeconds);
    await clearRefusals(task.host);
    await pool.query("UPDATE crawl_queue SET next_fetch_at = now() WHERE kind = $1 AND done_at IS NULL AND locked_at IS NULL", [kind]);
    return { ok: true, pausedUntil: null, message: `${s.name} answered. Checking it again now.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof HostRefusedError) {
      const until = await pauseHost(task.host, err.retryAfterSeconds);
      await deferTask(task, until, message);
      return { ok: false, pausedUntil: until.toISOString(), message: `${s.name} still answers ${err.status}. Paused until ${time(until)}.` };
    }
    await fail(task, message);
    return { ok: false, pausedUntil: null, message: `${s.name} could not be read: ${message}` };
  }
}
