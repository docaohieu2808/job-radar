// The crawl frontier (chapter 9's URL Frontier) on Postgres.
// A task is claimed together with its host row, both FOR UPDATE SKIP LOCKED, so two workers never
// hit the same host at once, and the host's politeness clock is advanced in the same transaction.
import { pool, withTransaction } from "./db.js";
import { config } from "./config.js";

export type Task = {
  id: number;
  kind: string;
  url: string;
  host: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export type EnqueueOptions = { priority?: number; payload?: Record<string, unknown>; notBefore?: Date };

export async function enqueue(kind: string, url: string, opts: EnqueueOptions = {}): Promise<void> {
  const host = new URL(url).host;
  await pool.query("INSERT INTO hosts (host) VALUES ($1) ON CONFLICT DO NOTHING", [host]);
  // Re-enqueueing a finished task revives it; an unfinished one keeps its place.
  await pool.query(
    `INSERT INTO crawl_queue (kind, url, host, payload, priority, next_fetch_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))
     ON CONFLICT (kind, url) DO UPDATE
       SET done_at = NULL, attempts = 0, last_error = NULL,
           payload = EXCLUDED.payload, priority = LEAST(crawl_queue.priority, EXCLUDED.priority),
           next_fetch_at = LEAST(crawl_queue.next_fetch_at, EXCLUDED.next_fetch_at)
       WHERE crawl_queue.done_at IS NOT NULL`,
    [kind, url, host, opts.payload ?? {}, opts.priority ?? 100, opts.notBefore ?? null],
  );
}

export async function claim(): Promise<Task | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<Task & { min_interval_s: number }>(
      `SELECT q.id, q.kind, q.url, q.host, q.payload, q.attempts, h.min_interval_s
         FROM crawl_queue q
         JOIN hosts h ON h.host = q.host
        WHERE q.done_at IS NULL AND q.locked_at IS NULL AND q.next_fetch_at <= now()
          AND h.next_allowed_at <= now()
          AND (h.blocked_until IS NULL OR h.blocked_until <= now())
          -- One request in flight per host, also when a task runs longer than the host's interval.
          AND NOT EXISTS (SELECT 1 FROM crawl_queue r WHERE r.host = q.host AND r.locked_at IS NOT NULL)
        ORDER BY q.priority, q.next_fetch_at
        LIMIT 1
        FOR UPDATE OF q, h SKIP LOCKED`,
    );
    const task = rows[0];
    if (!task) return null;
    await client.query("UPDATE crawl_queue SET locked_at = now(), attempts = attempts + 1 WHERE id = $1", [task.id]);
    await client.query("UPDATE hosts SET next_allowed_at = now() + make_interval(secs => $2) WHERE host = $1", [
      task.host,
      task.min_interval_s,
    ]);
    const { min_interval_s: _interval, ...rest } = task;
    return { ...rest, attempts: task.attempts + 1 };
  });
}

// Finished: either done for good, or scheduled again (recurring pages such as search results).
export async function complete(taskId: number, recrawlAfterSeconds?: number): Promise<void> {
  if (recrawlAfterSeconds === undefined) {
    await pool.query("UPDATE crawl_queue SET locked_at = NULL, interrupted = 0, done_at = now(), last_error = NULL, last_run_at = now() WHERE id = $1", [taskId]);
  } else {
    await pool.query(
      `UPDATE crawl_queue SET locked_at = NULL, interrupted = 0, attempts = 0, last_error = NULL, last_run_at = now(),
              next_fetch_at = now() + make_interval(secs => $2) WHERE id = $1`,
      [taskId, recrawlAfterSeconds],
    );
  }
}

// Exponential backoff: 1, 2, 4 ... minutes, capped at 6 hours.
export function backoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 6 * 3600);
}

// Recurring tasks (searches, feeds, career pages) must never die: after the last attempt they rest six hours
// and start counting again, keeping the error visible on the Sources screen meanwhile.
const RECURRING = /-search$|^directory-|^career-page$|^career-discover$/;

export async function fail(task: Task, error: string, maxAttempts = 5): Promise<"retry" | "dead"> {
  if (task.attempts >= maxAttempts && RECURRING.test(task.kind)) {
    await pool.query(
      `UPDATE crawl_queue SET locked_at = NULL, interrupted = 0, attempts = 0, last_error = $2, last_run_at = now(),
              next_fetch_at = now() + interval '6 hours' WHERE id = $1`,
      [task.id, error],
    );
    return "retry";
  }
  if (task.attempts >= maxAttempts) {
    await pool.query("UPDATE crawl_queue SET locked_at = NULL, interrupted = 0, done_at = now(), last_error = $2, last_run_at = now() WHERE id = $1", [task.id, error]);
    return "dead";
  }
  await pool.query(
    `UPDATE crawl_queue SET locked_at = NULL, interrupted = 0, last_error = $2, last_run_at = now(),
            next_fetch_at = now() + make_interval(secs => $3) WHERE id = $1`,
    [task.id, error, backoffSeconds(task.attempts)],
  );
  return "retry";
}

// A host that answered 429/403 is left alone until `until`.
export async function blockHost(host: string, until: Date): Promise<void> {
  await pool.query("UPDATE hosts SET blocked_until = $2 WHERE host = $1", [host, until]);
}

export const FIRST_PAUSE_SECONDS = 15 * 60;
export const MAX_PAUSE_SECONDS = 6 * 3600;

// Pauses a refusing host: the host's Retry-After when given, otherwise 15 minutes doubled for every
// refusal in a row (15, 30, 60, 120 min ... at most 6 h). Returns when the host may be tried again.
export async function pauseHost(host: string, retryAfterSeconds: number | null): Promise<Date> {
  const { rows } = await pool.query<{ blocked_until: Date }>(
    `UPDATE hosts SET refusals = refusals + 1,
            blocked_until = now() + make_interval(secs => LEAST(COALESCE($2, $3 * power(2, refusals)), $4))
      WHERE host = $1 RETURNING blocked_until`,
    [host, retryAfterSeconds, FIRST_PAUSE_SECONDS, MAX_PAUSE_SECONDS],
  );
  return rows[0]?.blocked_until ?? new Date(Date.now() + FIRST_PAUSE_SECONDS * 1000);
}

// A refusal is the host's state, not the task's fault: the task waits for the host without using up an attempt.
export async function deferTask(task: Task, until: Date, error: string): Promise<void> {
  await pool.query(
    `UPDATE crawl_queue SET locked_at = NULL, interrupted = 0, attempts = GREATEST(attempts - 1, 0), last_error = $2, last_run_at = now(),
            next_fetch_at = GREATEST(next_fetch_at, $3) WHERE id = $1`,
    [task.id, error, until],
  );
}

// The host answered normally: the next refusal starts from the shortest pause again, and tasks that were
// only waiting on the refusal no longer count as errors.
export async function clearRefusals(host: string): Promise<void> {
  const { rowCount } = await pool.query("UPDATE hosts SET refusals = 0, blocked_until = NULL WHERE host = $1 AND (refusals > 0 OR blocked_until IS NOT NULL)", [host]);
  if (rowCount)
    await pool.query("UPDATE crawl_queue SET last_error = NULL WHERE host = $1 AND done_at IS NULL AND last_error LIKE 'host refused%'", [host]);
}

// Releases tasks claimed by a worker that crashed or was restarted mid-task. At crawler start every lock is
// stale (one crawler process, and a graceful stop lets in-flight tasks finish); while running, locks older
// than the stale limit are freed periodically.
//
// Each release counts as an interruption. A task cut off QUARANTINE_AFTER times in a row is most likely what
// kills the worker, so it rests a day instead of being claimed again on every restart (on 24 Oct 2026 a
// 22.8 MB homepage crash-looped the crawler for 5.5 hours that way). Finishing in any way resets the count.
export const QUARANTINE_AFTER = 3;

export async function releaseStaleLocks(olderThanMinutes = config.staleLockMinutes): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE crawl_queue
        SET locked_at = NULL,
            interrupted = interrupted + 1,
            next_fetch_at = CASE WHEN interrupted + 1 >= $2 THEN now() + interval '1 day' ELSE next_fetch_at END,
            last_error = CASE WHEN interrupted + 1 >= $2
                              THEN 'quarantined for a day: cut off mid-run ' || (interrupted + 1) || ' times in a row'
                              ELSE last_error END
      WHERE locked_at <= now() - make_interval(mins => $1) AND done_at IS NULL`,
    [olderThanMinutes, QUARANTINE_AFTER],
  );
  return rowCount ?? 0;
}
