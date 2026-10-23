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
    await pool.query("UPDATE crawl_queue SET locked_at = NULL, done_at = now(), last_error = NULL WHERE id = $1", [taskId]);
  } else {
    await pool.query(
      `UPDATE crawl_queue SET locked_at = NULL, attempts = 0, last_error = NULL,
              next_fetch_at = now() + make_interval(secs => $2) WHERE id = $1`,
      [taskId, recrawlAfterSeconds],
    );
  }
}

// Exponential backoff: 1, 2, 4 ... minutes, capped at 6 hours.
export function backoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 6 * 3600);
}

export async function fail(task: Task, error: string, maxAttempts = 5): Promise<"retry" | "dead"> {
  if (task.attempts >= maxAttempts) {
    await pool.query("UPDATE crawl_queue SET locked_at = NULL, done_at = now(), last_error = $2 WHERE id = $1", [task.id, error]);
    return "dead";
  }
  await pool.query(
    `UPDATE crawl_queue SET locked_at = NULL, last_error = $2,
            next_fetch_at = now() + make_interval(secs => $3) WHERE id = $1`,
    [task.id, error, backoffSeconds(task.attempts)],
  );
  return "retry";
}

// A host that answered 429/403 is left alone until `until`.
export async function blockHost(host: string, until: Date): Promise<void> {
  await pool.query("UPDATE hosts SET blocked_until = $2 WHERE host = $1", [host, until]);
}

// Releases tasks claimed by a worker that crashed or was restarted mid-task.
export async function releaseStaleLocks(): Promise<number> {
  const { rowCount } = await pool.query(
    "UPDATE crawl_queue SET locked_at = NULL WHERE locked_at < now() - make_interval(mins => $1) AND done_at IS NULL",
    [config.staleLockMinutes],
  );
  return rowCount ?? 0;
}
