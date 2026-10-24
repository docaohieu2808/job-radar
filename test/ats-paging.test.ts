// ATS boards bigger than one page: every page is read, up to a cap.
import { afterEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
const { listAtsJobs } = await import("../src/sources/ats.js");

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

describe("ATS paging", () => {
  it("follows SmartRecruiters totalFound across pages", async () => {
    const offsets: number[] = [];
    globalThis.fetch = (async (u: string) => {
      const offset = Number(new URL(u).searchParams.get("offset"));
      offsets.push(offset);
      const count = Math.max(0, Math.min(100, 250 - offset));
      return json({
        totalFound: 250,
        content: Array.from({ length: count }, (_, i) => ({ id: `j${offset + i}`, name: "DevOps", ref: "x" })),
      });
    }) as typeof fetch;
    const jobs = await listAtsJobs({ kind: "smartrecruiters", board: "Acme" });
    expect(jobs).toHaveLength(250);
    expect(offsets).toEqual([0, 100, 200]);
  });

  it("follows Workday total per search word, and stops at the cap", async () => {
    let calls = 0;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      calls++;
      const { offset, searchText } = JSON.parse(String(init.body)) as { offset: number; searchText: string };
      const total = searchText === "devops" ? 45 : searchText === "sre" ? 500 : 0;
      const count = Math.max(0, Math.min(20, total - offset));
      return json({
        total,
        jobPostings: Array.from({ length: count }, (_, i) => ({ title: "x", externalPath: `/job/${searchText}-${offset + i}` })),
      });
    }) as typeof fetch;
    const jobs = await listAtsJobs({ kind: "workday", board: "acme", host: "acme.wd3.myworkdayjobs.com", site: "External" });
    // devops: 45 over 3 pages; sre: capped at 100 (5 pages); cloud and platform: one empty page each.
    expect(jobs.filter((j) => j.id.includes("devops"))).toHaveLength(45);
    expect(jobs.filter((j) => j.id.includes("sre"))).toHaveLength(100);
    expect(calls).toBe(3 + 5 + 1 + 1);
  });
});
