import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, scoreFromReasons, weighted, type Reason } from "../src/score-weights.js";
import { DEFAULT_PREFS } from "../src/prefs.js";

process.env.DATABASE_URL ??= "postgres://unused";
const { sanitizePrefs } = await import("../src/api/actions.js");

describe("weights", () => {
  const reasons: Reason[] = [
    { points: 12, label: "Cert sponsorship", cat: "benefits" },
    { points: 8, label: "Kubernetes, Docker", cat: "stack" },
    { points: -3, label: "Azure gap", cat: "stack" },
    { points: 3, label: "Hybrid", cat: "other" },
  ];
  it("counts every reason at its own points with the default weights", () => {
    expect(scoreFromReasons(reasons)).toBe(50 + 12 + 8 - 3 + 3);
  });
  it("scales a category by its weight and leaves work mode alone", () => {
    const w = { ...DEFAULT_WEIGHTS, benefits: 20, stack: 0 };
    expect(weighted(reasons[0], w)).toBe(24);
    expect(weighted(reasons[1], w)).toBe(0);
    expect(weighted(reasons[3], w)).toBe(3);
    expect(scoreFromReasons(reasons, w)).toBe(50 + 24 + 3);
  });
});

describe("sanitizePrefs", () => {
  it("clamps numbers, drops empty keywords and keeps unknown fields out", () => {
    const p = sanitizePrefs({ inboxMin: 500, weights: { ...DEFAULT_WEIGHTS, stack: -4 }, keywords: [" DevOps ", "", "DevOps", "SRE"], defaultSort: "nope" as never }, DEFAULT_PREFS);
    expect(p.inboxMin).toBe(100);
    expect(p.weights.stack).toBe(0);
    expect(p.keywords).toEqual(["DevOps", "SRE"]);
    expect(p.defaultSort).toBe("match");
  });
  it("never leaves the keyword list empty", () => {
    expect(sanitizePrefs({ keywords: [] }, DEFAULT_PREFS).keywords).toEqual(DEFAULT_PREFS.keywords);
  });
});
