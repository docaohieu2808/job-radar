// Operator commands: `node dist/src/cli.js enqueue <kind> <url>`, `rescore`, `sync-companies`.
import { pool } from "./db.js";
import { enqueue } from "./queue.js";
import { rescoreAll } from "./store.js";
import { ensureCompany, websiteFromEmails } from "./companies.js";
import { normalizeUrl } from "./sources/career.js";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "enqueue" && args.length === 2) await enqueue(args[0], args[1]);
  else if (command === "rescore") console.log(`rescored ${await rescoreAll()}`);
  else if (command === "normalize-career-pages") {
    // Merges career pages stored under two spellings of one address (www, trailing slash) into one.
    const { rows } = await pool.query<{ id: string; url: string }>("SELECT id, url FROM career_pages ORDER BY id");
    const seen = new Map<string, string>();
    let merged = 0;
    for (const r of rows) {
      const url = normalizeUrl(r.url);
      if (seen.has(url)) {
        await pool.query("DELETE FROM crawl_queue WHERE kind = 'career-page' AND (payload->>'careerPageId')::bigint = $1", [r.id]);
        await pool.query("DELETE FROM career_pages WHERE id = $1", [r.id]);
        merged++;
        continue;
      }
      seen.set(url, r.id);
      if (url !== r.url) {
        await pool.query("UPDATE career_pages SET url = $2 WHERE id = $1", [r.id, url]);
        await pool.query("UPDATE crawl_queue SET url = $2, host = $3 WHERE kind = 'career-page' AND (payload->>'careerPageId')::bigint = $1", [r.id, url, new URL(url).host]);
      }
    }
    console.log(`merged ${merged} of ${rows.length} career pages`);
  }
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
  else throw new Error("usage: enqueue <kind> <url> | rescore | sync-companies | normalize-career-pages");
  console.log("ok");
} finally {
  await pool.end();
}
