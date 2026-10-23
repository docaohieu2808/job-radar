// The owner's preferences, edited on the Settings screens and read by the crawler.
import { pool } from "./db.js";
import { DEFAULT_PREFS, type Prefs } from "./prefs.js";

export { DEFAULT_PREFS, type Prefs };

const CACHE_MS = 30_000;
let cached: { at: number; prefs: Prefs } | null = null;

export async function loadPrefs(): Promise<Prefs> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.prefs;
  const { rows } = await pool.query<{ value: Partial<Prefs> }>("SELECT value FROM settings WHERE key = 'prefs'");
  const stored = rows[0]?.value ?? {};
  const prefs: Prefs = {
    ...DEFAULT_PREFS,
    ...stored,
    weights: { ...DEFAULT_PREFS.weights, ...stored.weights },
    modes: { ...DEFAULT_PREFS.modes, ...stored.modes },
  };
  cached = { at: Date.now(), prefs };
  return prefs;
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('prefs', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(prefs)],
  );
  cached = { at: Date.now(), prefs };
}
