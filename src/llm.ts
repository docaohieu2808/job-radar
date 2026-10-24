// Gemini through 9Router (on the same node), used only as a fallback when a career page lists postings
// without links. Calls are capped per day; with no key configured the fallback is simply skipped.
import { pool } from "./db.js";
import { config } from "./config.js";

export const LLM_DAILY_LIMIT = 200;
// Link discovery has its own budget so judging new sites never starves reading career pages, and vice versa.
// Translation for the owner has its own budget too.
const BUDGETS = {
  pages: { prefix: "llm-calls", limit: LLM_DAILY_LIMIT },
  discovery: { prefix: "llm-discovery", limit: 300 },
  translate: { prefix: "llm-translate", limit: 400 },
} as const;
export type Budget = keyof typeof BUDGETS;

export function llmEnabled(): boolean {
  return Boolean(config.llmBaseUrl && config.llmApiKey && config.llmModel);
}

// Counts the call against today's budget (UTC day); false when the budget is used up.
async function takeBudget(budget: Budget): Promise<boolean> {
  const key = `${BUDGETS[budget].prefix}-${new Date().toISOString().slice(0, 10)}`;
  const { rows } = await pool.query<{ n: number }>(
    `INSERT INTO settings (key, value) VALUES ($1, '1'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = to_jsonb((settings.value)::text::int + 1), updated_at = now()
     RETURNING (value)::text::int AS n`,
    [key],
  );
  return rows[0].n <= BUDGETS[budget].limit;
}

export async function llmCallsToday(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("SELECT (value)::text::int AS n FROM settings WHERE key = $1", [`llm-calls-${new Date().toISOString().slice(0, 10)}`]);
  return Math.min(rows[0]?.n ?? 0, LLM_DAILY_LIMIT);
}

// Asks for JSON and returns the parsed object, or null when disabled, over budget or unparseable.
export async function askJson<T>(system: string, user: string, budget: Budget = "pages"): Promise<T | null> {
  if (!llmEnabled() || !(await takeBudget(budget))) return null;
  const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.llmApiKey}` },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: config.llmModel,
      temperature: 0,
      // 9Router streams unless told not to.
      stream: false,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user.slice(0, 24_000) }],
    }),
  });
  if (!res.ok) throw new Error(`llm ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
  } catch {
    return null;
  }
}
