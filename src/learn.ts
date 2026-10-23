// Learning from the owner's triage: postings they mark interested, applied, interviewing or offer count as liked,
// skipped ones as disliked. Each feature (a skill, the company, the level, the work mode, ...) gets a smoothed like
// rate; features clearly above or below the overall rate nudge new scores, within ±15, with the reason shown.
import { pool } from "./db.js";
import { normalizeKey } from "./normalize-key.js";
import type { Reason } from "./score-weights.js";
import type { Facts } from "./extract.js";
import { salaryInMillionVnd } from "./score.js";

export const MIN_LABELS = 10;
const MIN_FEATURE_COUNT = 3;
const MAX_ADJUST = 15;
// A feature liked every time against an overall rate of 50% moves the score by about 10 points.
const POINTS_PER_RATE = 20;
const LIKED = new Set(["interested", "applied", "interviewing", "offer"]);

export type Feature = { key: string; label: string };
export type Learned = { labels: number; liked: number; skipped: number; delta: Record<string, number>; labelOf: Record<string, string>; at: string };

export type FeatureInput = {
  stack: string[]; level: string | null; workMode: string | null; english: string | null;
  company: string; source: string | null; salaryM: number | null;
};

export function postingFeatures(p: FeatureInput): Feature[] {
  const out: Feature[] = p.stack.map((s) => ({ key: `stack:${s}`, label: s }));
  if (p.level && p.level !== "unknown") out.push({ key: `level:${p.level}`, label: `${p.level[0].toUpperCase()}${p.level.slice(1)} roles` });
  if (p.workMode && p.workMode !== "unknown") out.push({ key: `mode:${p.workMode}`, label: `${p.workMode} work` });
  if (p.english === "fluent" || p.english === "good") out.push({ key: `english:${p.english}`, label: `${p.english === "fluent" ? "Fluent" : "Good"} English` });
  if (p.company) out.push({ key: `company:${normalizeKey(p.company)}`, label: p.company });
  if (p.source) out.push({ key: `source:${p.source}`, label: `${p.source} postings` });
  if (p.salaryM !== null) out.push({ key: `salary:${p.salaryM >= 35 ? "35+" : p.salaryM >= 25 ? "25-35" : "<25"}`, label: `salary ${p.salaryM >= 35 ? "35M+" : p.salaryM >= 25 ? "25–35M" : "under 25M"}` });
  return out;
}

// The model from labelled examples; pure, so it can be tested without a database.
export function fit(examples: { liked: boolean; features: Feature[] }[]): Learned {
  const liked = examples.filter((e) => e.liked).length;
  const skipped = examples.length - liked;
  const base = (liked + 1) / (examples.length + 2);
  const counts = new Map<string, { n: number; liked: number; label: string }>();
  for (const e of examples) {
    for (const f of e.features) {
      const c = counts.get(f.key) ?? { n: 0, liked: 0, label: f.label };
      c.n++;
      if (e.liked) c.liked++;
      counts.set(f.key, c);
    }
  }
  const delta: Record<string, number> = {};
  const labelOf: Record<string, string> = {};
  for (const [key, c] of counts) {
    if (c.n < MIN_FEATURE_COUNT) continue;
    const d = ((c.liked + 1) / (c.n + 2) - base) * POINTS_PER_RATE;
    if (Math.abs(d) >= 1) {
      delta[key] = Math.round(d * 10) / 10;
      labelOf[key] = c.label;
    }
  }
  return { labels: examples.length, liked, skipped, delta, labelOf, at: new Date().toISOString() };
}

export function active(m: Learned | null): m is Learned {
  return Boolean(m && m.labels >= MIN_LABELS && m.liked > 0 && m.skipped > 0);
}

// At most two reasons: what pulls the score up and what pulls it down, scaled together to stay within ±15.
export function learnedReasons(m: Learned | null, features: Feature[]): Reason[] {
  if (!active(m)) return [];
  const hits = features.filter((f) => m.delta[f.key] !== undefined).map((f) => ({ label: m.labelOf[f.key], d: m.delta[f.key] }));
  const up = hits.filter((h) => h.d > 0).sort((a, b) => b.d - a.d);
  const down = hits.filter((h) => h.d < 0).sort((a, b) => a.d - b.d);
  const upSum = up.reduce((s, h) => s + h.d, 0);
  const downSum = down.reduce((s, h) => s + h.d, 0);
  const net = upSum + downSum;
  const scale = Math.abs(net) > MAX_ADJUST ? MAX_ADJUST / Math.abs(net) : 1;
  const names = (xs: { label: string }[]) => xs.slice(0, 3).map((x) => x.label).join(", ");
  const reasons: Reason[] = [];
  const upPts = Math.round(upSum * scale);
  const downPts = Math.round(downSum * scale);
  if (upPts) reasons.push({ cat: "learned", points: upPts, label: `Like ones you kept (${names(up)})` });
  if (downPts) reasons.push({ cat: "learned", points: downPts, label: `Like ones you skipped (${names(down)})` });
  return reasons;
}

const CACHE_MS = 30_000;
let cached: { at: number; model: Learned | null } | null = null;

export async function loadLearned(): Promise<Learned | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.model;
  const { rows } = await pool.query<{ value: Learned }>("SELECT value FROM settings WHERE key = 'learned'");
  cached = { at: Date.now(), model: rows[0]?.value ?? null };
  return cached.model;
}

// Refits from every triaged posting and stores the model.
export async function relearn(): Promise<Learned> {
  const { rows } = await pool.query<{
    status: string; stack: string[]; level: string | null; work_mode: string | null; english_required: string | null;
    company_name: string; source: string | null; salary_max: string | null; salary_min: string | null; currency: string | null;
  }>(
    `SELECT a.status, j.stack, j.level, j.work_mode, j.english_required, j.company_name, j.salary_max, j.salary_min, j.currency,
            (SELECT s.source FROM job_sources s WHERE s.job_id = j.id ORDER BY s.id LIMIT 1) AS source
       FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.status <> 'new'`,
  );
  const model = fit(rows.map((r) => ({ liked: LIKED.has(r.status), features: postingFeatures(featureInput(r)) })));
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('learned', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(model)],
  );
  cached = { at: Date.now(), model };
  return model;
}

export function factsFeatures(facts: Facts, company: string, source: string | null): Feature[] {
  return postingFeatures({
    stack: facts.stack, level: facts.level, workMode: facts.workMode, english: facts.english, company, source, salaryM: salaryInMillionVnd(facts),
  });
}

export function featureInput(r: {
  stack: string[] | null; level: string | null; work_mode: string | null; english_required: string | null; company_name: string;
  source: string | null; salary_max: string | null; salary_min: string | null; currency: string | null;
}): FeatureInput {
  const top = r.salary_max ?? r.salary_min;
  const salaryM = top === null ? null : (r.currency === "USD" ? Number(top) * 26_000 : Number(top)) / 1_000_000;
  return { stack: r.stack ?? [], level: r.level, workMode: r.work_mode, english: r.english_required, company: r.company_name, source: r.source, salaryM };
}
