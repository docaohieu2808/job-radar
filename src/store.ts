// Saving postings: one job per real-world posting, with every source it was seen on.
// URL Seen? = (source, external_id); the same posting on another board is matched by company + title.
// Content Seen? = hash of the normalized description; an unchanged posting is only touched, not re-extracted.
import { createHash } from "node:crypto";
import { pool, withTransaction } from "./db.js";
import { bareRemote, extractFacts, isRelevantTitle, isWantedLocation, openWidely, type WorkMode } from "./extract.js";
import type { Prefs } from "./prefs.js";
import { scorePosting } from "./score.js";
import { factsFeatures, learnedReasons, loadLearned } from "./learn.js";
import { trustReasons } from "./trust.js";
import { needsSummary, queueSummary } from "./translate.js";
import { loadPrefs } from "./settings.js";
import { normalizeKey } from "./normalize-key.js";
import { ensureCompany, websiteFromEmails } from "./companies.js";

export { normalizeKey };

export type Posting = {
  source: string;
  externalId: string;
  url: string;
  companyName: string;
  title: string;
  location: string;
  description: string;
  salaryText?: string;
  tags?: string[];
  postedAt?: Date | null;
  closed?: boolean;
  // The company's own website when the source states it (TopDev, VietnamWorks profile).
  companyWebsite?: { url: string | null; source: string };
  // A link to the company's applicant tracking board found in the posting (Greenhouse, Lever, ...).
  companyAts?: string | null;
};

export type SaveResult = { status: "skipped" | "new" | "reposted" | "updated" | "unchanged"; jobId?: number; score?: number };

export function dedupeKey(companyName: string, title: string): string {
  return `${normalizeKey(companyName)}|${normalizeKey(title)}`;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(normalizeKey(text)).digest("hex");
}

// Why a posting is not kept under the current preferences, or null when it is.
function rejection(title: string, location: string, workMode: WorkMode, prefs: Prefs, url = "", source = "", description = ""): string | null {
  if (!isRelevantTitle(title, prefs.keywords)) return "title";
  if (!isWantedLocation(location, workMode, `${title} ${url}`)) return "place";
  // Company boards abroad: plain "Remote" counts only when the text opens the role widely.
  if (source === "career" && bareRemote(location) && !openWidely(description)) return "place";
  if (workMode !== "unknown" && !prefs.modes[workMode]) return "work mode";
  return null;
}

async function reject(source: string, externalId: string, reason: string): Promise<void> {
  await pool.query(
    `INSERT INTO rejected_postings (source, external_id, reason) VALUES ($1, $2, $3)
     ON CONFLICT (source, external_id) DO UPDATE SET reason = EXCLUDED.reason, rejected_at = now()`,
    [source, externalId, reason],
  );
}

export async function savePosting(p: Posting): Promise<SaveResult> {
  // Some pages carry NUL characters, which Postgres text columns reject.
  p = { ...p, title: p.title.replace(/\u0000/g, ""), description: p.description.replace(/\u0000/g, "") };
  const prefs = await loadPrefs();
  const facts = extractFacts({ title: p.title, text: p.description, tags: p.tags, salaryText: p.salaryText, location: p.location });
  const rejected = rejection(p.title, p.location, facts.workMode, prefs, p.url, p.source, p.description);
  if (rejected) {
    await reject(p.source, p.externalId, rejected);
    return { status: "skipped" };
  }

  const learned = learnedReasons(await loadLearned(), factsFeatures(facts, p.companyName, p.source));
  // A new posting can only be flagged as second-hand here; age and the careers-page check come with rescoring.
  const trust = trustReasons({
    companyName: p.companyName, description: p.description, firstSeenAt: new Date(), reposted: false, now: new Date(),
    sources: [p.source], companyListsJobs: false, siteMatch: null,
  });
  const { score, reasons } = scorePosting(facts, prefs.weights, [...learned, ...trust]);
  const emailSite = websiteFromEmails(p.companyName, p.description);
  const companyId = await ensureCompany(p.companyName, p.companyWebsite?.url ? p.companyWebsite : emailSite ? { url: emailSite, source: "contact email" } : null);
  const hash = contentHash(p.description);
  const key = dedupeKey(p.companyName, p.title);
  const fields = [
    p.companyName, p.title, facts.salary?.min ?? null, facts.salary?.max ?? null, facts.salary?.currency ?? null,
    p.location, facts.workMode, facts.level, facts.years, JSON.stringify(facts.stack), JSON.stringify([]),
    facts.english, facts.certSupport, p.description, JSON.stringify(facts.excerpts), hash, score, JSON.stringify(reasons),
    key, p.postedAt ?? null,
  ];

  const result = await withTransaction(async (client) => {
    const bySource = await client.query<{ job_id: number; content_hash: string; closed_at: Date | null }>(
      `SELECT s.job_id, j.content_hash, j.closed_at FROM job_sources s JOIN jobs j ON j.id = s.job_id
        WHERE s.source = $1 AND s.external_id = $2 FOR UPDATE OF s`,
      [p.source, p.externalId],
    );
    let jobId = bySource.rows[0]?.job_id;
    let status: SaveResult["status"];

    if (jobId === undefined) {
      const byKey = await client.query<{ id: number; closed_at: Date | null }>(
        "SELECT id, closed_at FROM jobs WHERE dedupe_key = $1 ORDER BY closed_at NULLS FIRST, id DESC LIMIT 1",
        [key],
      );
      const match = byKey.rows[0];
      if (match) {
        jobId = match.id;
        status = match.closed_at ? "reposted" : "unchanged";
        if (match.closed_at) await client.query("UPDATE jobs SET closed_at = NULL, reposted_at = now() WHERE id = $1", [jobId]);
      } else {
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO jobs (company_name, title, salary_min, salary_max, currency, location, work_mode, level, years,
                             stack, benefits, english_required, cert_support, description, raw_excerpts, content_hash,
                             score, score_reasons, dedupe_key, posted_at, company_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
          [...fields, companyId],
        );
        jobId = inserted.rows[0].id;
        status = "new";
        await client.query("INSERT INTO applications (job_id) VALUES ($1)", [jobId]);
      }
      await client.query("INSERT INTO job_sources (job_id, source, external_id, url) VALUES ($1, $2, $3, $4)", [
        jobId, p.source, p.externalId, p.url,
      ]);
    } else {
      const known = bySource.rows[0];
      status = known.content_hash === hash ? "unchanged" : "updated";
      if (status === "updated") {
        await client.query(
          `UPDATE jobs SET company_name=$1, title=$2, salary_min=$3, salary_max=$4, currency=$5, location=$6, work_mode=$7,
                  level=$8, years=$9, stack=$10, benefits=$11, english_required=$12, cert_support=$13, description=$14,
                  raw_excerpts=$15, content_hash=$16, score=$17, score_reasons=$18, dedupe_key=$19,
                  posted_at=COALESCE($20, posted_at)
            WHERE id = $21`,
          [...fields, jobId],
        );
      }
      if (known.closed_at && !p.closed) {
        await client.query("UPDATE jobs SET closed_at = NULL, reposted_at = now() WHERE id = $1", [jobId]);
        status = "reposted";
      }
      await client.query("UPDATE job_sources SET last_seen_at = now(), missing_runs = 0 WHERE source = $1 AND external_id = $2", [
        p.source, p.externalId,
      ]);
    }

    await client.query(
      `UPDATE jobs SET last_seen_at = now(), company_id = COALESCE(company_id, $3),
              closed_at = CASE WHEN $2 THEN COALESCE(closed_at, now()) ELSE closed_at END WHERE id = $1`,
      [jobId, Boolean(p.closed), companyId],
    );
    return { status, jobId, score };
  });
  // English postings that reach the Inbox get a Vietnamese summary in the background (src/translate.ts).
  if (result.jobId && (result.status === "new" || result.status === "reposted") && score >= prefs.inboxMin && needsSummary(p.description)) {
    await queueSummary(result.jobId);
  }
  return result;
}

// Search results that list postings we already have: refresh last_seen without fetching the posting again.
// Returns the ids that are not known yet, so the caller fetches only those.
export async function markSeen(source: string, externalIds: string[]): Promise<string[]> {
  if (externalIds.length === 0) return [];
  const { rows } = await pool.query<{ external_id: string }>(
    `WITH seen AS (
       UPDATE job_sources SET last_seen_at = now(), missing_runs = 0
        WHERE source = $1 AND external_id = ANY($2) RETURNING job_id, external_id)
     , touched AS (UPDATE jobs SET last_seen_at = now() WHERE id IN (SELECT job_id FROM seen) RETURNING id)
     SELECT external_id FROM seen
     UNION SELECT external_id FROM rejected_postings
      WHERE source = $1 AND external_id = ANY($2) AND rejected_at > now() - interval '30 days'`,
    [source, externalIds],
  );
  // Known = stored, or read and rejected within the last month (preferences may change after that).
  const known = new Set(rows.map((r) => r.external_id));
  return externalIds.filter((id) => !known.has(id));
}

// Postings no source has listed for a week are treated as closed.
export async function closeStale(days = 7): Promise<number> {
  const { rowCount } = await pool.query(
    "UPDATE jobs SET closed_at = now() WHERE closed_at IS NULL AND last_seen_at < now() - make_interval(days => $1)",
    [days],
  );
  return rowCount ?? 0;
}

// Re-runs extraction and scoring on stored postings, after the rules change. Tags are not stored, so the
// detected stack is passed back in as tags to keep skills that only appeared there.
export async function rescoreAll(): Promise<number> {
  const prefs = await loadPrefs();
  const { rows } = await pool.query<{
    id: number; title: string; description: string; stack: string[]; salary_min: string | null; salary_max: string | null; currency: string | null; location: string; urls: string;
    company_name: string; source: string | null; first_seen_at: Date; reposted: boolean; sources: string[];
    lists_jobs: boolean; site_match: number | null;
  }>(`SELECT id, title, coalesce(description, '') AS description, stack, salary_min, salary_max, currency, coalesce(location, '') AS location,
             coalesce((SELECT string_agg(s.url, ' ') FROM job_sources s WHERE s.job_id = jobs.id), '') AS urls, company_name,
             (SELECT s.source FROM job_sources s WHERE s.job_id = jobs.id ORDER BY s.id LIMIT 1) AS source,
             first_seen_at, reposted_at IS NOT NULL AS reposted,
             coalesce((SELECT array_agg(DISTINCT s.source) FROM job_sources s WHERE s.job_id = jobs.id), '{}') AS sources,
             coalesce((SELECT bool_or(p.postings_found > 0 OR p.ats_kind IS NOT NULL) FROM career_pages p WHERE p.company_id = jobs.company_id AND p.status = 'found'), false) AS lists_jobs,
             (SELECT c.site_match FROM companies c WHERE c.id = jobs.company_id) AS site_match
        FROM jobs`);
  const model = await loadLearned();
  let dropped = 0;
  for (const r of rows) {
    const facts = extractFacts({ title: r.title, text: r.description, tags: r.stack, location: r.location });
    // Untriaged postings that the current keywords, places or work modes would not keep are removed;
    // anything the owner already acted on stays.
    const rejected = rejection(r.title, r.location, facts.workMode, prefs, r.urls, r.source ?? "", r.description);
    if (rejected) {
      const { rows: gone } = await pool.query<{ source: string; external_id: string }>(
        `WITH del AS (DELETE FROM jobs j USING applications a WHERE a.job_id = j.id AND j.id = $1 AND a.status = 'new' RETURNING j.id)
         SELECT s.source, s.external_id FROM job_sources s WHERE s.job_id IN (SELECT id FROM del)`,
        [r.id],
      );
      if (gone.length) {
        for (const g of gone) await reject(g.source, g.external_id, rejected);
        dropped++;
        continue;
      }
    }
    // A salary that came from the source's own salary field is not in the description; keep the stored one.
    if (!facts.salary && (r.salary_min !== null || r.salary_max !== null)) {
      facts.salary = {
        min: r.salary_min === null ? null : Number(r.salary_min),
        max: r.salary_max === null ? null : Number(r.salary_max),
        currency: r.currency === "USD" ? "USD" : "VND",
      };
    }
    const trust = trustReasons({
      companyName: r.company_name, description: r.description, firstSeenAt: r.first_seen_at, reposted: r.reposted, now: new Date(),
      sources: r.sources, companyListsJobs: r.lists_jobs, siteMatch: r.site_match,
    });
    const { score, reasons } = scorePosting(facts, prefs.weights, [...learnedReasons(model, factsFeatures(facts, r.company_name, r.source)), ...trust]);
    await pool.query(
      `UPDATE jobs SET work_mode=$2, level=$3, years=$4, stack=$5, english_required=$6, cert_support=$7,
              raw_excerpts = raw_excerpts || $8::jsonb, score=$9, score_reasons=$10 WHERE id=$1`,
      [r.id, facts.workMode, facts.level, facts.years, JSON.stringify(facts.stack), facts.english, facts.certSupport,
        JSON.stringify(facts.excerpts), score, JSON.stringify(reasons)],
    );
  }
  return rows.length - dropped;
}
