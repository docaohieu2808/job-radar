// Worker loop: claim a task, run its handler, record the outcome. Counters are flushed to crawl_runs every minute.
import { pool } from "./db.js";
import { claim, clearRefusals, complete, deferTask, fail, pauseHost, releaseStaleLocks, type Task } from "./queue.js";
import { handlers as baseHandlers, HostRefusedError } from "./handlers/index.js";
import { sourceHandlers } from "./sources/index.js";

type Counters = { fetched: number; errors: number; llmCalls: number; tasks: number };
const handlers = { ...baseHandlers, ...sourceHandlers };
const IDLE_WAIT_MS = 5_000;
const FLUSH_EVERY_MS = 60_000;

export class Worker {
  private counters: Counters = { fetched: 0, errors: 0, llmCalls: 0, tasks: 0 };
  private windowStart = new Date();

  constructor(private readonly concurrency: number) {}

  async run(signal: AbortSignal): Promise<void> {
    await releaseStaleLocks();
    const flusher = setInterval(() => void this.flush(), FLUSH_EVERY_MS);
    const lanes = Array.from({ length: this.concurrency }, () => this.lane(signal));
    await Promise.all(lanes);
    clearInterval(flusher);
    await this.flush();
  }

  private async lane(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let task: Task | null = null;
      try {
        task = await claim();
      } catch (err) {
        console.error("claim failed", err);
      }
      if (!task) {
        await sleep(IDLE_WAIT_MS, signal);
        continue;
      }
      await this.handle(task);
    }
  }

  private async handle(task: Task): Promise<void> {
    this.counters.tasks++;
    const handler = handlers[task.kind];
    if (!handler) {
      await fail(task, `no handler for kind ${task.kind}`, 1);
      this.counters.errors++;
      return;
    }
    try {
      const result = await handler(task);
      this.counters.fetched += result.fetched ?? 0;
      this.counters.llmCalls += result.llmCalls ?? 0;
      await complete(task.id, result.recrawlAfterSeconds);
      await clearRefusals(task.host);
    } catch (err) {
      this.counters.errors++;
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof HostRefusedError) {
        // The pause is visible on the Sources screen (hosts.blocked_until).
        const until = await pauseHost(task.host, err.retryAfterSeconds);
        console.warn(`${task.host} answered ${err.status}; paused until ${until.toISOString()}`);
        await deferTask(task, until, message);
        return;
      }
      const outcome = await fail(task, message);
      // A task that gave up keeps last_error; the Sources screen lists those.
      if (outcome === "dead") console.error(`gave up after ${task.attempts} attempts: ${task.kind} ${task.url}: ${message}`);
    }
  }

  private async flush(): Promise<void> {
    const c = this.counters;
    const started = this.windowStart;
    this.counters = { fetched: 0, errors: 0, llmCalls: 0, tasks: 0 };
    this.windowStart = new Date();
    if (c.tasks === 0) return;
    await pool
      .query(
        "INSERT INTO crawl_runs (started_at, finished_at, kind, fetched, errors, llm_calls, detail) VALUES ($1, now(), 'worker', $2, $3, $4, $5)",
        [started, c.fetched, c.errors, c.llmCalls, { tasks: c.tasks }],
      )
      .catch((err) => console.error("flush failed", err));
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
