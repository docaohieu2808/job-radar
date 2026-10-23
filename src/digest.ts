// Telegram output: an instant alert for top matches, and one morning digest of everything new worth a look.
import { pool } from "./db.js";
import { escapeHtml, sendMessage } from "./telegram.js";
import { closeStale } from "./store.js";
import type { Reason } from "./score.js";

export const DIGEST_MIN_SCORE = 60;
export const ALERT_MIN_SCORE = 85;
const DIGEST_HOUR = 8;
const DIGEST_MAX_LINES = 25;

type Row = {
  id: number;
  score: number;
  company_name: string;
  title: string;
  salary_min: string | null;
  salary_max: string | null;
  currency: string | null;
  score_reasons: Reason[];
  url: string;
  sources: number;
  reposted: boolean;
};

export function formatSalary(min: number | null, max: number | null, currency: string | null): string {
  if (min === null && max === null) return "Salary not shown";
  const f = (v: number) => (currency === "USD" ? `$${v.toLocaleString("en-US")}` : `${Math.round(v / 1_000_000)}M`);
  const suffix = currency === "USD" ? "" : " VND";
  if (min !== null && max !== null) return `${f(min)}–${f(max)}${suffix}`;
  return max !== null ? `Up to ${f(max)}${suffix}` : `From ${f(min!)}${suffix}`;
}

export function formatLine(r: Row): string {
  const salary = formatSalary(r.salary_min === null ? null : Number(r.salary_min), r.salary_max === null ? null : Number(r.salary_max), r.currency);
  const reasons = r.score_reasons.slice(0, 3).map((x) => `${x.points > 0 ? "+" : "−"} ${x.label}`).join(" · ");
  const extra = [r.sources > 1 ? `${r.sources} sources` : "", r.reposted ? "Reposted" : ""].filter(Boolean).join(" · ");
  return [
    `<b>${r.score}</b> · ${escapeHtml(r.company_name)} — <a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a>`,
    `${salary}${extra ? ` · ${extra}` : ""}`,
    reasons ? escapeHtml(reasons) : "",
  ].filter(Boolean).join("\n");
}

const SELECT_ROWS = `
  SELECT j.id, j.score, j.company_name, j.title, j.salary_min, j.salary_max, j.currency, j.score_reasons,
         (SELECT url FROM job_sources s WHERE s.job_id = j.id ORDER BY s.first_seen_at LIMIT 1) AS url,
         (SELECT count(*)::int FROM job_sources s WHERE s.job_id = j.id) AS sources,
         j.reposted_at IS NOT NULL AS reposted
    FROM jobs j JOIN applications a ON a.job_id = j.id
   WHERE j.closed_at IS NULL AND a.status = 'new'`;

export async function sendInstantAlerts(): Promise<number> {
  const { rows } = await pool.query<Row>(
    `${SELECT_ROWS} AND j.alerted_at IS NULL AND j.score >= $1 AND greatest(j.first_seen_at, coalesce(j.reposted_at, j.first_seen_at)) > now() - interval '1 day'
     ORDER BY j.score DESC LIMIT 5`,
    [ALERT_MIN_SCORE],
  );
  for (const r of rows) {
    await sendMessage(`Top match\n\n${formatLine(r)}`);
    await pool.query("UPDATE jobs SET alerted_at = now() WHERE id = $1", [r.id]);
  }
  return rows.length;
}

async function lastDigestAt(): Promise<Date | null> {
  const { rows } = await pool.query<{ value: string }>("SELECT value FROM settings WHERE key = 'last_digest_at'");
  return rows[0] ? new Date(rows[0].value) : null;
}

export async function sendDailyDigest(now = new Date()): Promise<number> {
  const since = (await lastDigestAt()) ?? new Date(now.getTime() - 24 * 3600_000);
  const { rows } = await pool.query<Row>(
    `${SELECT_ROWS} AND j.score >= $1 AND greatest(j.first_seen_at, coalesce(j.reposted_at, j.first_seen_at)) > $2
     ORDER BY j.score DESC LIMIT $3`,
    [DIGEST_MIN_SCORE, since, DIGEST_MAX_LINES],
  );
  const sinceText = since.toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const text = rows.length
    ? `<b>${rows.length} new postings</b> since ${sinceText}\n\n${rows.map(formatLine).join("\n\n")}`
    : `Nothing new above ${DIGEST_MIN_SCORE} since ${sinceText}.`;
  await sendMessage(text);
  await pool.query("UPDATE jobs SET digested_at = now() WHERE id = ANY($1)", [rows.map((r) => r.id)]);
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('last_digest_at', to_jsonb($1::text)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    [now.toISOString()],
  );
  return rows.length;
}

// Local date and hour in Ho Chi Minh City.
export function localClock(d: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

// Called every minute: alerts any time, the digest and the stale sweep once a day after 08:00.
export async function tick(now = new Date()): Promise<void> {
  await sendInstantAlerts();
  const local = localClock(now);
  if (local.hour < DIGEST_HOUR) return;
  const last = await lastDigestAt();
  if (last && localClock(last).date === local.date) return;
  await closeStale();
  await sendDailyDigest(now);
}
