// Writes from the screens: triage status, watchlist, preferences.
import { pool } from "../db.js";
import { savePrefs, loadPrefs } from "../settings.js";
import { DEFAULT_PREFS, type Prefs } from "../prefs.js";
import { rescoreAll } from "../store.js";
import { normalizeKey } from "../normalize-key.js";
import { ensureCompany, siteRoot } from "../companies.js";

const STATUSES = new Set(["new", "interested", "applied", "interviewing", "offer", "skipped"]);

// `note` undefined keeps the current note; null clears it.
export async function setStatus(jobId: number, status: string, note?: string | null): Promise<void> {
  if (!STATUSES.has(status)) throw new BadRequest(`unknown status ${status}`);
  const { rowCount } = await pool.query(
    `UPDATE applications SET status = $2, note = CASE WHEN $3::boolean THEN $4::text ELSE note END, updated_at = now() WHERE job_id = $1`,
    [jobId, status, note !== undefined, note ?? null],
  );
  if (!rowCount) throw new NotFound(`job ${jobId}`);
}

export async function setWatch(name: string, watch: boolean): Promise<void> {
  if (!name.trim()) throw new BadRequest("company name is empty");
  await pool.query(
    `INSERT INTO companies (name, key, watch, discovered_via) VALUES ($1, $2, $3, 'watchlist')
     ON CONFLICT (key) DO UPDATE SET watch = EXCLUDED.watch`,
    [name.trim(), normalizeKey(name), watch],
  );
  // A newly watched company is read right away, ahead of the queue, instead of on its next quiet-page date.
  if (watch) {
    await pool.query(
      `UPDATE crawl_queue q SET next_fetch_at = now(), priority = LEAST(q.priority, 30)
         FROM career_pages p JOIN companies c ON c.id = p.company_id
        WHERE c.key = $1 AND q.kind = 'career-page' AND (q.payload->>'careerPageId')::bigint = p.id AND q.done_at IS NULL`,
      [normalizeKey(name)],
    );
  }
}

// The owner's own website for a company outranks anything found automatically, and restarts discovery.
export async function setWebsite(name: string, website: string): Promise<void> {
  if (!siteRoot(website)) throw new BadRequest("not a website address");
  await ensureCompany(name.trim(), { url: website, source: "owner" });
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
};

// Accepts only known fields within their ranges; anything else falls back to the current value.
export function sanitizePrefs(input: Partial<Prefs>, current: Prefs): Prefs {
  const w = input.weights ?? current.weights;
  const keywords = Array.isArray(input.keywords)
    ? [...new Set(input.keywords.map((k) => String(k).trim()).filter((k) => k && k.length <= 60))].slice(0, 50)
    : current.keywords;
  return {
    weights: {
      salary: clamp(w.salary, 0, 50, current.weights.salary),
      stack: clamp(w.stack, 0, 50, current.weights.stack),
      level: clamp(w.level, 0, 50, current.weights.level),
      english: clamp(w.english, 0, 50, current.weights.english),
      benefits: clamp(w.benefits, 0, 50, current.weights.benefits),
    },
    inboxMin: clamp(input.inboxMin, 0, 100, current.inboxMin),
    topMin: clamp(input.topMin, 0, 100, current.topMin),
    keywords: keywords.length ? keywords : DEFAULT_PREFS.keywords,
    modes: {
      remote: input.modes?.remote ?? current.modes.remote,
      hybrid: input.modes?.hybrid ?? current.modes.hybrid,
      onsite: input.modes?.onsite ?? current.modes.onsite,
    },
    newDays: clamp(input.newDays, 1, 90, current.newDays),
    defaultSort: input.defaultSort === "newest" || input.defaultSort === "match" ? input.defaultSort : current.defaultSort,
  };
}

export async function updatePrefs(input: Partial<Prefs>): Promise<Prefs> {
  const current = await loadPrefs();
  const next = sanitizePrefs(input, current);
  await savePrefs(next);
  // New weights change every stored score.
  if (JSON.stringify(next.weights) !== JSON.stringify(current.weights)) await rescoreAll();
  return next;
}

export class BadRequest extends Error {}
export class NotFound extends Error {}
