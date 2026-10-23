import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
const { pagePriority, readInterval, relevance } = await import("../src/relevance.js");

const base = { postings: 0, liked: 0, skipped: 0, ats: false, careerFound: false, remoteBoard: false, watch: false };

describe("best-first frontier", () => {
  it("ranks a company that posted DevOps roles above one that never did", () => {
    const posted = relevance({ ...base, postings: 2, careerFound: true });
    const never = relevance({ ...base, careerFound: true });
    expect(posted.score).toBeGreaterThan(never.score);
    expect(posted.reasons[0]).toContain("2 DevOps");
    expect(pagePriority(posted.score)).toBeLessThan(pagePriority(never.score));
  });

  it("lowers a company the owner keeps skipping and stays within 0–100", () => {
    expect(relevance({ ...base, postings: 1, skipped: 3 }).score).toBe(0);
    expect(relevance({ ...base, postings: 9, watch: true, ats: true, remoteBoard: true, liked: 5 }).score).toBe(100);
  });

  it("reads relevant companies more often, everyone at least daily", () => {
    expect(readInterval(60, false)).toBe(6 * 3600);
    expect(readInterval(30, false)).toBe(12 * 3600);
    expect(readInterval(0, false)).toBe(24 * 3600);
    expect(readInterval(0, true)).toBe(12 * 3600);
  });
});
