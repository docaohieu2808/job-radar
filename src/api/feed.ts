// Read-only digest of the Inbox for an outside assistant (a ChatGPT scheduled task) that cannot join the tailnet.
// Served on its own public host under /feed/<FEED_TOKEN>/...; everything else on the site stays tailnet-only.
import { timingSafeEqual } from "node:crypto";
import { pool } from "../db.js";
import { loadPrefs } from "../settings.js";
import { loadDescription } from "./state.js";
import type { ViSummary } from "../translate.js";

// True when the token in the URL matches FEED_TOKEN. No token configured means the feed is off.
export function feedTokenOk(given: string | undefined, expected = process.env.FEED_TOKEN ?? ""): boolean {
  if (expected.length < 24 || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Row = {
  id: string; score: number; title: string; company_name: string; location: string | null; work_mode: string | null;
  salary_min: string | null; salary_max: string | null; currency: string | null; first_seen_at: Date;
  reasons: { label: string; points: number }[]; url: string | null; vi_summary: ViSummary | null;
};

// Open, untriaged postings at or above the Inbox threshold, first seen in the last `days` days, best first.
export async function loadMatches(days: number): Promise<{ inboxMin: number; rows: Row[] }> {
  const prefs = await loadPrefs();
  const { rows } = await pool.query<Row>(
    `SELECT j.id, j.score, j.title, j.company_name, j.location, j.work_mode, j.salary_min, j.salary_max, j.currency, j.first_seen_at,
            j.score_reasons AS reasons, j.vi_summary,
            (SELECT s.url FROM job_sources s WHERE s.job_id = j.id ORDER BY s.id LIMIT 1) AS url
       FROM jobs j JOIN applications a ON a.job_id = j.id
      WHERE j.closed_at IS NULL AND a.status = 'new' AND j.score >= $1 AND j.first_seen_at > now() - make_interval(days => $2)
      ORDER BY j.score DESC, j.first_seen_at DESC`,
    [prefs.inboxMin, days],
  );
  return { inboxMin: prefs.inboxMin, rows };
}

function salaryText(r: Row): string {
  const pay = r.salary_max ?? r.salary_min;
  return pay === null ? "salary hidden" : `up to ${Number(pay).toLocaleString("en-US")} ${r.currency ?? ""}`.trim();
}

function list(title: string, items: string[]): string[] {
  return items.length ? [`  ${title}:`, ...items.map((x) => `    - ${x}`)] : [];
}

// Plain text (Markdown-ish) so a browsing assistant reads it as a page, with each posting's Vietnamese summary inline.
export async function digestText(days: number, base: string): Promise<string> {
  const { inboxMin, rows } = await loadMatches(days);
  const out = [
    `# Job Radar digest — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
    "",
    `${rows.length} open postings scored ${inboxMin}+ first seen in the last ${days} days, not yet triaged by the owner.`,
    "Owner: DevOps engineer in Ho Chi Minh City. Onsite/hybrid only in HCMC; remote anywhere if open to Vietnam/APAC.",
    `Full posting text: ${base}/jobs/<id> (same token).`,
  ];
  for (const r of rows) {
    const why = r.reasons.slice(0, 8).map((x) => `${x.points > 0 ? "+" : ""}${x.points} ${x.label}`).join(", ");
    out.push(
      "",
      `## [${r.score}] ${r.title} — ${r.company_name} (id ${r.id})`,
      `  ${r.location || "location not stated"} | ${r.work_mode ?? "unknown"} | ${salaryText(r)} | first seen ${r.first_seen_at.toISOString().slice(0, 10)}`,
      `  why scored: ${why}`,
      `  source: ${r.url ?? "n/a"}`,
    );
    const vi = r.vi_summary;
    if (vi) out.push(`  tóm tắt: ${vi.summary}`, ...list("yêu cầu", vi.requirements), ...list("phúc lợi", vi.benefits), ...list("cần để ý", vi.notes));
  }
  return out.join("\n") + "\n";
}

// One posting in full, for follow-up questions about it.
export async function jobText(id: number): Promise<string | null> {
  const { rows } = await pool.query<{ title: string; company_name: string; location: string | null; work_mode: string | null }>(
    "SELECT title, company_name, location, work_mode FROM jobs WHERE id = $1", [id],
  );
  const d = await loadDescription(id);
  if (!rows[0] || !d) return null;
  const r = rows[0];
  return [`# ${r.title} — ${r.company_name} (id ${id})`, `${r.location || "location not stated"} | ${r.work_mode ?? "unknown"}`, "", d.description, ""].join("\n");
}
