// Parsers against real pages saved on 23 Oct 2026.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
const linkedin = await import("../src/sources/linkedin.js");
const itviec = await import("../src/sources/itviec.js");
const topdev = await import("../src/sources/topdev.js");
const vnw = await import("../src/sources/vietnamworks.js");

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("linkedin", () => {
  it("reads every card of a search page", () => {
    const cards = linkedin.parseSearch(fixture("linkedin-search.html"));
    expect(cards).toHaveLength(10);
    expect(cards[0]).toEqual({ id: "4470814149", title: "Senior DevOps Engineer (Azure)", company: "fram^", location: "Ho Chi Minh City, Vietnam", postedAt: "2026-09-27" });
  });

  it("reads a posting, including that it is closed", () => {
    const p = linkedin.parsePosting(fixture("linkedin-posting.html"), "4405304602");
    expect(p.title).toBe("Devops Engineer (từ 3 năm KN)");
    expect(p.companyName).toBe("Tinhvan Software JSC.");
    expect(p.location).toBe("Quận 7, Ho Chi Minh City, Vietnam");
    expect(p.description).toContain("hỗ trợ 100% chi phí thi các chứng chỉ");
    expect(p.description).toContain("Seniority level: Mid-Senior level");
    expect(p.closed).toBe(true);
  });
});

describe("itviec", () => {
  it("finds posting slugs on the listing", () => {
    const found = itviec.parseSearch(fixture("itviec-search.html"));
    expect(found.length).toBeGreaterThanOrEqual(15);
    expect(found.map((f) => f.slug)).toContain("cloud-native-devops-engineer-endava-viet-nam-5841");
  });

  it("reads a posting page", () => {
    const p = itviec.parsePosting(fixture("itviec-posting.html"), "cloud-native-devops-engineer-endava-viet-nam-5841");
    expect(p.title).toBe("Cloud Native DevOps Engineer");
    expect(p.companyName).toBe("Endava Việt Nam");
    expect(p.externalId).toBe("5841");
    expect(p.location).toContain("Ho Chi Minh");
    expect(p.tags).toEqual(expect.arrayContaining(["Docker", "GitLab", "Kubernetes"]));
    expect(p.description).toContain("Hybrid");
    expect(p.description).toContain("1-3 years of experience");
  });
});

describe("topdev", () => {
  it("maps API postings and leaves hidden salaries empty", () => {
    const body = JSON.parse(fixture("topdev-search.json"));
    const p = topdev.toPosting(body.data[0]);
    expect(p.title).toBe("DevOps Engineer");
    expect(p.companyName).toBe("Globaltech");
    expect(p.url).toBe("https://topdev.vn/detail-jobs/devops-engineer-globaltech-2137249");
    expect(p.salaryText).toBeUndefined();
    expect(p.location).toContain("Hồ Chí Min");
    expect(p.postedAt?.toISOString()).toBe("2026-10-06T17:00:00.000Z");
  });
});

describe("vietnamworks", () => {
  it("maps API postings", () => {
    const body = JSON.parse(fixture("vietnamworks-search.json"));
    const p = vnw.toPosting(body.data[0]);
    expect(p.externalId).toBe("2117946");
    expect(p.companyName).toContain("VIETNAMPOST");
    expect(p.salaryText).toBeUndefined();
    expect(p.description).toContain("Mô tả công việc");
  });
});
