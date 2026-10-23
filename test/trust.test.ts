import { describe, expect, it } from "vitest";
import { postingConfidence, siteMatch, trustReasons } from "../src/trust.js";

const now = new Date("2026-10-24T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const base = { companyName: "Acme Software", description: "We run Kubernetes.", firstSeenAt: daysAgo(1), reposted: false, now, sources: ["itviec"], companyListsJobs: false, siteMatch: null };

describe("trust", () => {
  it("grades posting pages by their sections", () => {
    expect(postingConfidence("Mô tả công việc ... Yêu cầu ... Quyền lợi ... Ứng tuyển")).toBe("sure");
    expect(postingConfidence("Requirements: 3 years experience")).toBe("maybe");
    expect(postingConfidence("Our DevOps services help you scale.")).toBe("no");
  });

  it("matches a site by name, source, e-mail and footer", () => {
    const tinhvan = siteMatch({ companyName: "TINH VÂN SOFTWARE", website: "https://tinhvan.com", websiteSource: "topdev", pageText: "Copyright Tinh Vân Software. MST 0101234567", emailDomains: ["tinhvan.com"] });
    expect(tinhvan.score).toBeGreaterThanOrEqual(60);
    const wrong = siteMatch({ companyName: "Acme Software", website: "https://randomshop.vn", websiteSource: "contact email", pageText: "Giỏ hàng", emailDomains: [] });
    expect(wrong.score).toBeLessThan(30);
  });

  it("flags stale, reposted, second-hand and missing-from-careers postings", () => {
    expect(trustReasons(base)).toEqual([]);
    expect(trustReasons({ ...base, firstSeenAt: daysAgo(60), reposted: true })[0].label).toBe("Open 60 days, reposted");
    expect(trustReasons({ ...base, companyName: "ABC Recruitment Solutions" })[0].label).toContain("Recruiter");
    expect(trustReasons({ ...base, description: "Our client, a leading bank, is hiring a DevOps engineer." })[0].label).toContain("Recruiter");
    expect(trustReasons({ ...base, description: "- Trang chủ\n- Khách hàng của chúng tôi\n- Tuyển dụng" })).toEqual([]);
    expect(trustReasons({ ...base, description: "Khách hàng của chúng tôi là một ngân hàng lớn" })[0].label).toContain("Recruiter");
    expect(trustReasons({ ...base, firstSeenAt: daysAgo(5), companyListsJobs: true })[0].label).toContain("careers page");
    expect(trustReasons({ ...base, sources: ["career"], siteMatch: 10 })[0].label).toContain("Website not confirmed");
  });
});
