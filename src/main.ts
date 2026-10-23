// Crawler process: migrate, seed the recurring searches, then run the worker until SIGTERM.
import { config } from "./config.js";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";
import { Worker } from "./worker.js";
import { seedSources } from "./sources/index.js";
import { closeStale } from "./store.js";

const HOUR_MS = 3600_000;

async function main(): Promise<void> {
  const applied = await migrate();
  if (applied.length) console.log(`applied ${applied.join(", ")}`);
  await seedSources();

  const controller = new AbortController();
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => controller.abort());

  // Postings no source has listed for a week are closed; checking hourly is plenty.
  const sweeper = setInterval(() => void closeStale().catch((err) => console.error("close stale failed", err)), HOUR_MS);
  controller.signal.addEventListener("abort", () => clearInterval(sweeper), { once: true });

  await new Worker(config.workerConcurrency).run(controller.signal);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
