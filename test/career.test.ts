// Career-page discovery helpers.
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
const { detectAts } = await import("../src/sources/ats.js");
const { links, mainText, needsBrowser, registrableDomain, sameSite, wantedCareerLocation } = await import("../src/sources/career.js");
const { siteRoot, websiteFromEmails, websiteFromText } = await import("../src/companies.js");

describe("company websites", () => {
  it("normalizes a website to its root and refuses job boards", () => {
    expect(siteRoot("https://www.tinhvan.com/vi/tuyen-dung")).toBe("https://tinhvan.com");
    expect(siteRoot("vexere.com")).toBe("https://vexere.com");
    expect(siteRoot("https://www.linkedin.com/company/x")).toBeNull();
  });
  it("trusts a contact e-mail only when its domain resembles the company", () => {
    expect(websiteFromEmails("Tinhvan Software JSC.", "Gửi CV qua email: lienpta@tinhvan.com")).toBe("https://tinhvan.com");
    expect(websiteFromEmails("Navigos Search's Client", "Contact hr@navigosgroup.com")).toBeNull();
    expect(websiteFromEmails("Con Cưng", "Liên hệ tuyendung@gmail.com")).toBeNull();
  });
  it("takes the first non-board link from a profile text", () => {
    expect(websiteFromText("VinUniversity (VinUni: https://vinuni.edu.vn/) is the first private")).toBe("https://vinuni.edu.vn");
  });
});

describe("career pages", () => {
  it("recognises ATS boards from their links", () => {
    expect(detectAts("https://boards.greenhouse.io/cloudflare")).toEqual({ kind: "greenhouse", board: "cloudflare" });
    expect(detectAts("https://job-boards.greenhouse.io/embed/job_board?for=acme")).toEqual({ kind: "greenhouse", board: "acme" });
    expect(detectAts("https://jobs.lever.co/palantir/123")).toEqual({ kind: "lever", board: "palantir" });
    expect(detectAts("https://endava.wd3.myworkdayjobs.com/en-US/External")).toEqual({ kind: "workday", board: "endava", host: "endava.wd3.myworkdayjobs.com", site: "External" });
    expect(detectAts("https://careers.smartrecruiters.com/Visa")).toEqual({ kind: "smartrecruiters", board: "Visa" });
    expect(detectAts("https://tinhvan.com/vi/tuyen-dung")).toBeNull();
  });
  it("treats subdomains of the company as the same site", () => {
    expect(registrableDomain("careers.vexere.com")).toBe("vexere.com");
    expect(registrableDomain("tuyendung.fpt.com.vn")).toBe("fpt.com.vn");
    expect(sameSite("https://careers.vexere.com/opening-jobs", "https://vexere.com")).toBe(true);
    expect(sameSite("https://example.org/jobs", "https://vexere.com")).toBe(false);
  });
  it("reads links and the main text, without menus", () => {
    const html = `<html><body><nav><a href="/about">About</a></nav><main><h1>Careers</h1>${"<p>We build things.</p>".repeat(40)}
      <a href="/jobs/devops-engineer#apply">DevOps Engineer</a><a href="mailto:hr@x.vn">Mail</a></main><footer>© X</footer></body></html>`;
    expect(links(html, "https://x.vn/careers").map((l) => l.url)).toEqual(["https://x.vn/about", "https://x.vn/jobs/devops-engineer"]);
    expect(mainText(html)).toContain("DevOps Engineer");
    expect(mainText(html)).not.toContain("©");
  });
  it("treats only listing pages as listings", async () => {
    const { isListing } = await import("../src/sources/career.js");
    expect(isListing({ url: "https://sacombankcareer.com/go/careers/", text: "Careers" })).toBe(true);
    expect(isListing({ url: "https://x.vn/tuyen-dung", text: "Tuyển dụng" })).toBe(true);
    expect(isListing({ url: "https://globaltechjsc.com/tu-van-he-thong", text: "Tư vấn hệ thống" })).toBe(false);
    expect(isListing({ url: "https://globaltechjsc.com/tuyen-dung-vi-tri-network-engineer", text: "Network Engineer" })).toBe(false);
    expect(isListing({ url: "https://x.vn/about", text: "Vị trí đang tuyển" })).toBe(true);
  });

  it("tells job titles from service pages", async () => {
    const { looksLikeJobTitle, looksLikePosting } = await import("../src/sources/career.js");
    const { DEFAULT_PREFS } = await import("../src/prefs.js");
    const kw = DEFAULT_PREFS.keywords;
    expect(looksLikeJobTitle("Infrastructure & Cloud Operations Engineer", kw)).toBe(true);
    expect(looksLikeJobTitle("Senior SRE / Observability Engineer", kw)).toBe(true);
    expect(looksLikeJobTitle("Cloud & DevOps Services", kw)).toBe(false);
    expect(looksLikeJobTitle("Infrastructure Advisory", kw)).toBe(false);
    expect(looksLikeJobTitle("Hỗ trợ vận hành hệ thống CNTT", kw)).toBe(false);
    expect(looksLikePosting("Mô tả công việc ... Yêu cầu: 3 năm kinh nghiệm ... Quyền lợi")).toBe(true);
    expect(looksLikePosting("Our DevOps services help you scale. Contact us.")).toBe(false);
  });

  it("spots an empty JavaScript shell", () => {
    expect(needsBrowser('<div id="root"></div><script src="/app.js"></script>', "")).toBe(true);
    expect(needsBrowser("<main>long text</main>", "x".repeat(500))).toBe(false);
  });
  it("keeps ATS postings in Vietnam or remote Asia only", () => {
    expect(wantedCareerLocation("Ho Chi Minh City, Vietnam")).toBe(true);
    expect(wantedCareerLocation("London, UK")).toBe(false);
    expect(wantedCareerLocation("Remote - APAC")).toBe(true);
    expect(wantedCareerLocation("")).toBe(true);
  });
});
