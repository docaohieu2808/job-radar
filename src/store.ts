// Saving postings: one job per real-world posting, with every source it was seen on.
// URL Seen? = (source, external_id); the same posting on another board is matched by company + title.
// Content Seen? = hash of the normalized description; an unchanged posting is only touched, not re-extracted.
import { createHash } from "node:crypto";
import { pool, withTransaction } from "./db.js";
import { extractFacts, isRelevantTitle, isWantedLocation } from "./extract.js";
import { scorePosting } from "./score.js";

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
};

export type SaveResult = { status: "skipped" | "new" | "reposted" | "updated" | "unchanged"; jobId?: number; score?: number };

export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/\b(cong ty|company|co\.?,? ?ltd|jsc|tnhh|co phan|corporation|corp|vietnam|viet nam|inc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function dedupeKey(companyName: string, title: string): string {
  return `${normalizeKey(companyName)}|${normalizeKey(title)}`;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(normalizeKey(text)).digest("hex");
}

export async function savePosting(p: Posting): Promise<SaveResult> {
  const facts = extractFacts({ title: p.title, text: p.description, tags: p.tags, salaryText: p.salaryText });
  if (!isRelevantTitle(p.title) || !isWantedLocation(p.location, facts.workMode)) return { status: "skipped" };

  const { score, reasons } = scorePosting(facts);
  const hash = contentHash(p.description);
  const key = dedupeKey(p.companyName, p.title);
  const fields = [
    p.companyName, p.title, facts.salary?.min ?? null, facts.salary?.max ?? null, facts.salary?.currency ?? null,
    p.location, facts.workMode, facts.level, facts.years, JSON.stringify(facts.stack), JSON.stringify([]),
    facts.english, facts.certSupport, p.description, JSON.stringify(facts.excerpts), hash, score, JSON.stringify(reasons),
    key, p.postedAt ?? null,
  ];

  return withTransaction(async (client) => {
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
                             score, score_reasons, dedupe_key, posted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
          fields,
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
      `UPDATE jobs SET last_seen_at = now(), closed_at = CASE WHEN $2 THEN COALESCE(closed_at, now()) ELSE closed_at END WHERE id = $1`,
      [jobId, Boolean(p.closed)],
    );
    return { status, jobId, score };
  });
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
     SELECT external_id FROM seen`,
    [source, externalIds],
  );
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
