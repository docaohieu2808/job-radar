// Applies migrations/*.sql in name order, once each, recorded in schema_migrations.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool, withTransaction } from "./db.js";

// Resolved from the working directory so it is the same for compiled code and tests.
const migrationsDir = path.resolve(process.cwd(), "migrations");

export async function migrate(): Promise<string[]> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    applied.push(file);
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then((applied) => console.log(applied.length ? `applied ${applied.join(", ")}` : "schema up to date"))
    .finally(() => pool.end());
}
