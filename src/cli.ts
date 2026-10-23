// Operator commands: `node dist/src/cli.js enqueue <kind> <url>`, `rescore`, `sync-companies`.
import { pool } from "./db.js";
import { enqueue } from "./queue.js";
import { rescoreAll } from "./store.js";
import { ensureCompany, websiteFromEmails } from "./companies.js";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "enqueue" && args.length === 2) await enqueue(args[0], args[1]);
  else if (command === "rescore") console.log(`rescored ${await rescoreAll()}`);
  else if (command === "sync-companies") {
    // Records the company of every stored posting, with a website from its contact e-mail when there is one.
    const { rows } = await pool.query<{ id: string; company_name: string; description: string | null }>("SELECT id, company_name, description FROM jobs");
    for (const r of rows) {
      const site = websiteFromEmails(r.company_name, r.description ?? "");
      const companyId = await ensureCompany(r.company_name, site ? { url: site, source: "contact email" } : null);
      await pool.query("UPDATE jobs SET company_id = $2 WHERE id = $1", [r.id, companyId]);
    }
    console.log(`synced ${rows.length} postings`);
  }
  else throw new Error("usage: enqueue <kind> <url> | rescore | sync-companies");
  console.log("ok");
} finally {
  await pool.end();
}
