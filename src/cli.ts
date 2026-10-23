// Operator commands: `node dist/src/cli.js enqueue <kind> <url>`, `rescore`, `sync-companies`, `matches [days]`.
import { pool } from "./db.js";
import { enqueue } from "./queue.js";
import { rescoreAll } from "./store.js";
import { ensureCompany, websiteFromEmails } from "./companies.js";
import { normalizeUrl } from "./sources/career.js";
import { loadPrefs } from "./settings.js";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "enqueue" && args.length === 2) await enqueue(args[0], args[1]);
  else if (command === "rescore") console.log(`rescored ${await rescoreAll()}`);
  else if (command === "normalize-career-pages") {
    // Merges career pages stored under two spellings of one address (www, trailing slash) into one.
    const { rows } = await pool.query<{ id: string; url: string }>("SELECT id, url FROM career_pages ORDER BY id");
    const groups = new Map<string, { id: string; url: string }[]>();
    for (const r of rows) {
      const url = normalizeUrl(r.url);
      groups.set(url, [...(groups.get(url) ?? []), r]);
    }
    let merged = 0;
    for (const [url, group] of groups) {
      // Keep the row already stored under the normalized address, else the oldest.
      const keep = group.find((r) => r.url === url) ?? group[0];
      for (const r of group.filter((x) => x !== keep)) {
        await pool.query("DELETE FROM crawl_queue WHERE kind = 'career-page' AND (payload->>'careerPageId')::bigint = $1", [r.id]);
        await pool.query("DELETE FROM career_pages WHERE id = $1", [r.id]);
        merged++;
      }
      if (keep.url !== url) {
        await pool.query("UPDATE career_pages SET url = $2 WHERE id = $1", [keep.id, url]);
        await pool.query("UPDATE crawl_queue SET url = $2, host = $3 WHERE kind = 'career-page' AND (payload->>'careerPageId')::bigint = $1", [keep.id, url, new URL(url).host]);
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
  else if (command === "matches") {
    // The Inbox as plain text, for answering "any good jobs today?" from a terminal or a chat session:
    // open, untriaged postings at or above the Inbox threshold, first seen in the last N days (default 7).
    const days = Number(args[0] ?? 7);
    const prefs = await loadPrefs();
    const { rows } = await pool.query<{
      id: string; score: number; title: string; company_name: string; location: string | null; work_mode: string | null;
      salary_min: string | null; salary_max: string | null; currency: string | null; first_seen_at: Date; reasons: { label: string; points: number }[]; url: string | null;
    }>(
      `SELECT j.id, j.score, j.title, j.company_name, j.location, j.work_mode, j.salary_min, j.salary_max, j.currency, j.first_seen_at,
              j.score_reasons AS reasons, (SELECT s.url FROM job_sources s WHERE s.job_id = j.id ORDER BY s.id LIMIT 1) AS url
         FROM jobs j JOIN applications a ON a.job_id = j.id
        WHERE j.closed_at IS NULL AND a.status = 'new' AND j.score >= $1 AND j.first_seen_at > now() - make_interval(days => $2)
        ORDER BY j.score DESC, j.first_seen_at DESC`,
      [prefs.inboxMin, days],
    );
    console.log(`${rows.length} postings scored ${prefs.inboxMin}+ first seen in the last ${days} days, not yet triaged`);
    for (const r of rows) {
      const pay = r.salary_max ?? r.salary_min;
      const salary = pay === null ? "salary hidden" : `up to ${Number(pay).toLocaleString("en-US")} ${r.currency ?? ""}`.trim();
      const why = r.reasons.slice(0, 6).map((x) => `${x.points > 0 ? "+" : ""}${x.points} ${x.label}`).join(", ");
      console.log(`\n[${r.score}] ${r.title} | ${r.company_name}`);
      console.log(`  ${r.location || "location not stated"} | ${r.work_mode ?? "unknown"} | ${salary} | first seen ${r.first_seen_at.toISOString().slice(0, 10)}`);
      console.log(`  why: ${why}`);
      console.log(`  ${r.url ?? ""}  (web: https://jobs.docaohieu.com/#/jobs/${r.id})`);
    }
  }
  else throw new Error("usage: enqueue <kind> <url> | rescore | sync-companies | normalize-career-pages | matches [days]");
  console.log("ok");
} finally {
  await pool.end();
}
