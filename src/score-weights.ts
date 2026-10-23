// Turning reasons into a match score with the owner's weights. Shared by the crawler and the web screens,
// so the Settings preview shows exactly the score the crawler will store.

// "learned" comes from the owner's own triage (src/learn.ts) and, like "other", is not reweighted.
export type Category = "salary" | "stack" | "level" | "english" | "benefits" | "other" | "learned";
export type Weights = Record<Exclude<Category, "other" | "learned">, number>;
export type Reason = { points: number; label: string; cat: Category };

// The reference weights: at these values every reason counts its own points.
export const DEFAULT_WEIGHTS: Weights = { salary: 20, stack: 40, level: 20, english: 10, benefits: 10 };
export const BASE_SCORE = 50;

export function weighted(reason: Reason, weights: Weights): number {
  if (reason.cat === "other" || reason.cat === "learned") return reason.points;
  return Math.round((reason.points * weights[reason.cat]) / DEFAULT_WEIGHTS[reason.cat]);
}

export function scoreFromReasons(reasons: Reason[], weights: Weights = DEFAULT_WEIGHTS): number {
  const total = reasons.reduce((sum, r) => sum + weighted(r, weights), BASE_SCORE);
  return Math.max(0, Math.min(100, total));
}
