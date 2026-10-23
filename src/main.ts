// Crawler process: migrate, then run the worker and the Telegram command listener until SIGTERM.
import { config } from "./config.js";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";
import { Worker } from "./worker.js";
import { pollCommands, sendMessage } from "./telegram.js";

async function status(): Promise<string> {
  const { rows } = await pool.query<{ pending: string; dead: string; last: string | null }>(
    `SELECT (SELECT count(*) FROM crawl_queue WHERE done_at IS NULL) AS pending,
            (SELECT count(*) FROM crawl_queue WHERE done_at IS NOT NULL AND last_error IS NOT NULL) AS dead,
            (SELECT to_char(max(finished_at) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD Mon HH24:MI') FROM crawl_runs) AS last`,
  );
  const r = rows[0];
  return `pong · ${r.pending} tasks waiting · ${r.dead} failed · last run ${r.last ?? "never"}`;
}

async function main(): Promise<void> {
  const applied = await migrate();
  if (applied.length) console.log(`applied ${applied.join(", ")}`);

  const controller = new AbortController();
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => controller.abort());

  const worker = new Worker(config.workerConcurrency);
  await sendMessage("Job Radar started.").catch((err) => console.error("telegram send failed", err));
  await Promise.all([
    worker.run(controller.signal),
    pollCommands(async (command) => (command === "/ping" ? status() : "Commands: /ping"), controller.signal),
  ]);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
