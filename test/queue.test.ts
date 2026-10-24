// Integration tests for the frontier. Need TEST_DATABASE_URL pointing at a throwaway database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = testUrl ?? "postgres://unused";

const { pool } = await import("../src/db.js");
const { migrate } = await import("../src/migrate.js");
const { backoffSeconds, claim, complete, enqueue, fail, blockHost, pauseHost, clearRefusals, deferTask, releaseStaleLocks, QUARANTINE_AFTER } = await import("../src/queue.js");

describe("backoffSeconds", () => {
  it("doubles from one minute and caps at six hours", () => {
    expect(backoffSeconds(1)).toBe(60);
    expect(backoffSeconds(2)).toBe(120);
    expect(backoffSeconds(5)).toBe(960);
    expect(backoffSeconds(20)).toBe(6 * 3600);
  });
});

describe.skipIf(!testUrl)("crawl queue", () => {
  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate();
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE crawl_queue, hosts RESTART IDENTITY CASCADE");
  });
  afterAll(async () => {
    await pool.end();
  });

  it("never hands out two tasks of the same host at once", async () => {
    await enqueue("noop", "https://a.example/1");
    await enqueue("noop", "https://a.example/2");
    await enqueue("noop", "https://b.example/1");
    const claimed = await Promise.all([claim(), claim(), claim()]);
    const hosts = claimed.filter(Boolean).map((t) => t!.host).sort();
    expect(hosts).toEqual(["a.example", "b.example"]);
  });

  it("waits for the host interval before the next task of that host", async () => {
    await enqueue("noop", "https://a.example/1");
    await enqueue("noop", "https://a.example/2");
    const first = await claim();
    await complete(first!.id);
    expect(await claim()).toBeNull();
    await pool.query("UPDATE hosts SET next_allowed_at = now() - interval '1 second'");
    expect((await claim())?.url).toBe("https://a.example/2");
  });

  it("skips blocked hosts", async () => {
    await enqueue("noop", "https://a.example/1");
    await blockHost("a.example", new Date(Date.now() + 3600_000));
    expect(await claim()).toBeNull();
  });

  it("pauses a refusing host 15 min, doubling per refusal, and starts over after a success", async () => {
    await enqueue("noop", "https://a.example/1");
    const minutes = async () => {
      const until = await pauseHost("a.example", null);
      return Math.round((until.getTime() - Date.now()) / 60_000);
    };
    expect(await minutes()).toBe(15);
    expect(await minutes()).toBe(30);
    expect(await minutes()).toBe(60);
    await clearRefusals("a.example");
    expect(await minutes()).toBe(15);
    const until = await pauseHost("a.example", 120);
    expect(Math.round((until.getTime() - Date.now()) / 1000)).toBe(120);
  });

  it("keeps a refused task's attempts and makes it wait for the host", async () => {
    await enqueue("noop", "https://a.example/1");
    const task = await claim();
    const until = await pauseHost("a.example", null);
    await deferTask(task!, until, "host refused with 429");
    const { rows } = await pool.query("SELECT attempts, locked_at, next_fetch_at >= $1 AS waits FROM crawl_queue", [until]);
    expect(rows[0]).toEqual({ attempts: 0, locked_at: null, waits: true });
  });

  it("retries with backoff, then gives up", async () => {
    await enqueue("noop", "https://a.example/1");
    const task = await claim();
    expect(await fail(task!, "boom", 2)).toBe("retry");
    const { rows } = await pool.query("SELECT next_fetch_at > now() + interval '50 seconds' AS later, last_error FROM crawl_queue");
    expect(rows[0]).toEqual({ later: true, last_error: "boom" });
    expect(await fail({ ...task!, attempts: 2 }, "boom again", 2)).toBe("dead");
  });

  it("reschedules recurring tasks instead of finishing them", async () => {
    await enqueue("noop", "https://a.example/search");
    const task = await claim();
    await complete(task!.id, 3600);
    const { rows } = await pool.query("SELECT done_at, locked_at, next_fetch_at > now() + interval '59 minutes' AS later FROM crawl_queue");
    expect(rows[0]).toEqual({ done_at: null, locked_at: null, later: true });
  });

  it("revives a finished task when it is enqueued again", async () => {
    await enqueue("noop", "https://a.example/1");
    await complete((await claim())!.id);
    await enqueue("noop", "https://a.example/1");
    const { rows } = await pool.query("SELECT done_at FROM crawl_queue");
    expect(rows[0].done_at).toBeNull();
  });

  // Simulates a worker that dies with the task in hand: claim, then the next start releases every lock.
  async function crashWith(url: string) {
    await pool.query("UPDATE crawl_queue SET next_fetch_at = now() WHERE url = $1", [url]);
    await pool.query("UPDATE hosts SET next_allowed_at = now()"); // skip the per-host pacing between restarts
    const task = await claim();
    expect(task?.url).toBe(url);
    await releaseStaleLocks(0);
  }

  it("quarantines a task that keeps killing the worker", async () => {
    await enqueue("career-discover", "https://huge.example/");
    for (let i = 0; i < QUARANTINE_AFTER; i++) await crashWith("https://huge.example/");
    const { rows } = await pool.query(
      "SELECT interrupted, locked_at, next_fetch_at > now() + interval '23 hours' AS resting, last_error FROM crawl_queue");
    expect(rows[0]).toMatchObject({ interrupted: QUARANTINE_AFTER, locked_at: null, resting: true });
    expect(rows[0].last_error).toMatch(/^quarantined/);
    expect(await claim()).toBeNull();
  });

  it("does not quarantine a task that was only caught in a crash and then finished", async () => {
    await enqueue("noop", "https://ok.example/1");
    await crashWith("https://ok.example/1");
    await crashWith("https://ok.example/1");
    await pool.query("UPDATE crawl_queue SET next_fetch_at = now()");
    await pool.query("UPDATE hosts SET next_allowed_at = now()");
    await complete((await claim())!.id, 60);
    const { rows } = await pool.query("SELECT interrupted, last_error FROM crawl_queue");
    expect(rows[0]).toEqual({ interrupted: 0, last_error: null });
  });
});
