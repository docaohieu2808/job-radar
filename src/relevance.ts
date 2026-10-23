// Best-first crawling: each company gets a relevance score (how likely it is to have a DevOps opening) and its
// career pages are read sooner and more often the higher it is. Every company is still read at least daily.
import { pool } from "./db.js";

const HOUR = 3600;

export type RelevanceInput = {
  postings: number; liked: number; skipped: number; ats: boolean; careerFound: boolean; remoteBoard: boolean; watch: boolean;
};

export function relevance(c: RelevanceInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (c.postings > 0) {
    score += Math.min(40, 20 + 10 * (c.postings - 1));
    reasons.push(`${c.postings} DevOps or infra posting${c.postings > 1 ? "s" : ""} seen`);
  }
  if (c.watch) {
    score += 20;
    reasons.push("on your watchlist");
  }
  if (c.ats) {
    score += 10;
    reasons.push("ATS board");
  } else if (c.careerFound) {
    score += 10;
    reasons.push("career page");
  }
  if (c.remoteBoard) {
    score += 10;
    reasons.push("hires remotely");
  }
  if (c.liked) {
    score += 10 * c.liked;
    reasons.push(`you kept ${c.liked}`);
  }
  if (c.skipped) {
    score -= 10 * c.skipped;
    reasons.push(`you skipped ${c.skipped}`);
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// How long a quiet career page may wait before it is read again.
export function readInterval(score: number, watch: boolean): number {
  const byScore = score >= 50 ? 6 * HOUR : score >= 25 ? 12 * HOUR : 24 * HOUR;
  return watch ? Math.min(byScore, 12 * HOUR) : byScore;
}

// Queue priority of a company's career pages: lower runs first; 70 is the plain default.
export function pagePriority(score: number): number {
  return 70 - Math.round(score / 5);
}

export async function recomputeRelevance(): Promise<number> {
  const { rows } = await pool.query<{
    id: string; postings: string; liked: string; skipped: string; ats: boolean; career_found: boolean; remote_board: boolean; watch: boolean;
  }>(`SELECT c.id,
             (SELECT count(*) FROM jobs j WHERE j.company_id = c.id) AS postings,
             (SELECT count(*) FROM jobs j JOIN applications a ON a.job_id = j.id WHERE j.company_id = c.id AND a.status IN ('interested','applied','interviewing','offer')) AS liked,
             (SELECT count(*) FROM jobs j JOIN applications a ON a.job_id = j.id WHERE j.company_id = c.id AND a.status = 'skipped') AS skipped,
             EXISTS (SELECT 1 FROM career_pages p WHERE p.company_id = c.id AND p.ats_kind IS NOT NULL) AS ats,
             c.career_status = 'found' AS career_found, c.website_source = 'remote board' AS remote_board, c.watch
        FROM companies c`);
  const ids: number[] = [];
  const scores: number[] = [];
  const reasons: string[] = [];
  for (const r of rows) {
    const v = relevance({
      postings: Number(r.postings), liked: Number(r.liked), skipped: Number(r.skipped),
      ats: r.ats, careerFound: r.career_found, remoteBoard: Boolean(r.remote_board), watch: r.watch,
    });
    ids.push(Number(r.id));
    scores.push(v.score);
    reasons.push(JSON.stringify(v.reasons));
  }
  await pool.query(
    `UPDATE companies c SET relevance = u.score, relevance_reasons = u.reasons::jsonb
       FROM unnest($1::bigint[], $2::int[], $3::text[]) AS u(id, score, reasons) WHERE c.id = u.id`,
    [ids, scores, reasons],
  );
  // The frontier follows: career pages of relevant companies come first.
  await pool.query(
    `UPDATE crawl_queue q SET priority = 70 - round(c.relevance / 5.0)::int
       FROM career_pages p JOIN companies c ON c.id = p.company_id
      WHERE q.kind = 'career-page' AND q.done_at IS NULL AND (q.payload->>'careerPageId')::bigint = p.id`,
  );
  return rows.length;
}
