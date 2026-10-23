import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
const { fit, learnedReasons, postingFeatures, MIN_LABELS } = await import("../src/learn.js");

const posting = (stack: string[], level: string, company = "Acme") =>
  postingFeatures({ stack, level, workMode: "hybrid", english: null, company, source: "itviec", salaryM: null });

describe("learning from triage", () => {
  // The owner keeps Kubernetes roles and skips Senior ones.
  const examples = [
    ...Array.from({ length: 8 }, (_, i) => ({ liked: true, features: posting(["Kubernetes", "Docker"], "middle", `Kept ${i}`) })),
    ...Array.from({ length: 8 }, (_, i) => ({ liked: false, features: posting(["Java"], "senior", `Skipped ${i}`) })),
    ...Array.from({ length: 4 }, (_, i) => ({ liked: i < 2, features: posting(["Linux"], "middle", `Mixed ${i}`) })),
  ];
  const model = fit(examples);

  it("raises what was kept and lowers what was skipped", () => {
    const up = learnedReasons(model, posting(["Kubernetes"], "unknown", "New"));
    const down = learnedReasons(model, posting([], "senior", "New"));
    expect(up.reduce((s, r) => s + r.points, 0)).toBeGreaterThan(0);
    expect(up[0].label).toContain("Kubernetes");
    expect(down.reduce((s, r) => s + r.points, 0)).toBeLessThan(0);
    expect(down[0].label).toContain("Senior");
  });

  it("stays within 15 points", () => {
    const r = learnedReasons(model, posting(["Kubernetes", "Docker"], "middle", "New"));
    expect(Math.abs(r.reduce((s, x) => s + x.points, 0))).toBeLessThanOrEqual(15);
  });

  it("does nothing before enough decisions, or with only one kind", () => {
    expect(learnedReasons(fit(examples.slice(0, MIN_LABELS - 1)), posting(["Kubernetes"], "middle"))).toEqual([]);
    expect(learnedReasons(fit(examples.slice(0, 8)), posting(["Kubernetes"], "middle"))).toEqual([]);
  });

  it("ignores a feature seen fewer than three times", () => {
    expect(model.delta["company:kept 0"]).toBeUndefined();
  });
});
