// Regression tests for the defects found in the backend review of 24 Oct 2026 (queue lifecycle, remote and
// closed rules, rescoring, extraction). DB cases need TEST_DATABASE_URL; the rest are pure.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = testUrl ?? "postgres://unused";
const { pool } = await import("../src/db.js");
const { migrate } = await import("../src/migrate.js");
const queue = await import("../src/queue.js");
const store = await import("../src/store.js");
const ex = await import("../src/extract.js");
const { allowedBy } = await import("../src/robots.js");
const { toPosting: vnwPosting } = await import("../src/sources/vietnamworks.js");

describe("extraction rules", () => {
  it("does not read Internal or International as an intern role", () => {
    expect(ex.detectLevel("Internal Platform Engineer", "").level).not.toBe("intern");
    expect(ex.detectLevel("DevOps Engineer - International Payments", "").level).not.toBe("intern");
    expect(ex.detectLevel("DevOps Intern", "").level).toBe("intern");
  });

  it("keeps a monthly salary monthly next to yearly bonuses or leave", () => {
    expect(ex.parseSalary("Lương: 25 - 35 triệu, thưởng hằng năm")?.max).toBe(35_000_000);
    expect(ex.parseSalary("Salary: 25 - 35M. We offer annual leave")?.max).toBe(35_000_000);
    expect(ex.parseSalary("800 - 1200 USD")).toEqual({ min: 800, max: 1200, currency: "USD" });
  });

  it("does not take the employer's nationality as a language requirement", () => {
    expect(ex.detectForeignLanguage("We are a Japanese company offering good benefits").language).toBeNull();
    expect(ex.detectForeignLanguage("A Korean-owned firm. Business hours 9-18.").language).toBeNull();
    expect(ex.detectForeignLanguage("Good Japanese communication skills").language).toBe("Japanese");
    expect(ex.detectForeignLanguage("Tiếng Nhật N2 trở lên").language).toBe("Japanese N2");
  });

  it("does not see Australia or the US inside Vietnamese words", () => {
    expect(ex.detectAbroad("Làm việc với đội ngũ kiến trúc sư giàu kinh nghiệm").abroad).toBe(false);
    expect(ex.detectAbroad("Cơ hội làm việc tại Úc 6 tháng").abroad).toBe(true);
  });

  it("drops onsite roles in other provinces and reads remote perks as not remote", () => {
    expect(ex.isWantedLocation("Thuận An, Bình Dương", "onsite")).toBe(false);
    expect(ex.isWantedLocation("Quy Nhơn, Bình Định", "onsite")).toBe(false);
    expect(ex.detectWorkMode("We support remote working on Fridays.").mode).not.toBe("remote");
    expect(ex.detectWorkMode("This is a fully remote position.").mode).toBe("remote");
    expect(ex.isWantedLocation("Remote (Anywhere in the US)", "remote")).toBe(false);
  });

  it("takes required years, not the company's track record", () => {
    const r = ex.detectLevel("DevOps Engineer", "We have 10 years of experience in outsourcing.\nRequirements: 2 years in DevOps experience");
    expect(r.years).toBe(2);
  });

  it("keeps Go when the stored stack is passed back as tags", () => {
    expect(ex.detectStack("Docker\nGo\nLinux")).toContain("Go");
    expect(ex.detectStack("Let's go to the office")).not.toContain("Go");
  });

  it("reads VietnamWorks salaries, including VND amounts labelled USD", () => {
    expect(ex.parseSalary("15 triệu - 40 triệu")).toEqual({ min: 15_000_000, max: 40_000_000, currency: "VND" });
    const p = vnwPosting({ jobId: 1, jobTitle: "DevOps", jobUrl: "https://www.vietnamworks.com/x", companyName: "Acme", salaryMin: 15_000_000, salaryMax: 40_000_000, salaryCurrency: "USD", isSalaryVisible: true } as never);
    expect(ex.parseSalary(p.salaryText ?? "")).toEqual({ min: 15_000_000, max: 40_000_000, currency: "VND" });
  });
});

describe("robots.txt", () => {
  it("honours wildcards, end anchors and Allow", () => {
    expect(allowedBy("User-agent: *\nDisallow: /careers/*", "/careers/devops")).toBe(false);
    expect(allowedBy("User-agent: *\nDisallow: /*.pdf$", "/jd.pdf")).toBe(false);
    expect(allowedBy("User-agent: *\nDisallow: /*.pdf$", "/jd.pdf.html")).toBe(true);
    expect(allowedBy("User-agent: *\nDisallow: /\nAllow: /careers", "/careers/devops")).toBe(true);
    expect(allowedBy("User-agent: *\nDisallow: /", "/about")).toBe(false);
  });
});

const base = {
  source: "career", externalId: "gh:acme:1", url: "https://boards.greenhouse.io/acme/jobs/1", companyName: "Acme",
  title: "Site Reliability Engineer", location: "Remote", description: "We are fully distributed and hire worldwide. Kubernetes, Terraform.",
};

describe.skipIf(!testUrl)("queue and store against Postgres", () => {
  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate();
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE crawl_queue, hosts, jobs, job_sources, applications, rejected_postings, settings, companies RESTART IDENTITY CASCADE");
  });

  it("frees every lock at crawler start, however recent", async () => {
    await queue.enqueue("linkedin-search", "https://www.linkedin.com/a");
    const t = await queue.claim();
    expect(t).not.toBeNull();
    expect(await queue.releaseStaleLocks(0)).toBe(1);
    await pool.query("UPDATE hosts SET next_allowed_at = now()");
    expect(await queue.claim()).not.toBeNull();
  });

  it("keeps a recurring search alive after five failures", async () => {
    await queue.enqueue("topdev-search", "https://api.topdev.vn/x");
    const t = (await queue.claim())!;
    expect(await queue.fail({ ...t, attempts: 5 }, "boom")).toBe("retry");
    const { rows } = await pool.query("SELECT done_at, attempts, last_error FROM crawl_queue WHERE id = $1", [t.id]);
    expect(rows[0]).toMatchObject({ done_at: null, attempts: 0, last_error: "boom" });
  });

  it("never hands out a second task of a host while one is in flight", async () => {
    await queue.enqueue("career-page", "https://acme.vn/a");
    await queue.enqueue("career-page", "https://acme.vn/b");
    await pool.query("UPDATE hosts SET min_interval_s = 0");
    const first = await queue.claim();
    expect(first).not.toBeNull();
    expect(await queue.claim()).toBeNull();
  });

  it("caps an absurd Retry-After at six hours", async () => {
    await queue.enqueue("career-page", "https://acme.vn/a");
    const until = await queue.pauseHost("acme.vn", 8_000_000_000_000);
    expect(until.getTime() - Date.now()).toBeLessThanOrEqual(6 * 3600 * 1000 + 5000);
  });

  it("keeps a plain Remote role whose text opens it worldwide, and drops one that does not", async () => {
    expect((await store.savePosting(base)).status).toBe("new");
    const closed = { ...base, externalId: "gh:acme:2", url: "https://boards.greenhouse.io/acme/jobs/2", title: "SRE II", description: "Kubernetes. Our team works from Austin." };
    expect((await store.savePosting(closed)).status).toBe("skipped");
  });

  it("drops remote roles limited to residents elsewhere", async () => {
    const p = { ...base, location: "Remote (Worldwide)", description: "Kubernetes. Candidates must be located in the US." };
    expect((await store.savePosting(p)).status).toBe("skipped");
  });

  it("skips postings without an employer instead of merging them", async () => {
    expect((await store.savePosting({ ...base, companyName: "" })).status).toBe("skipped");
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM jobs");
    expect(rows[0].n).toBe(0);
  });

  it("merges parallel saves of one posting from six sources into one job", async () => {
    const saves = Array.from({ length: 6 }, (_, i) =>
      store.savePosting({ ...base, source: `board${i}`, externalId: `x${i}`, url: `https://board${i}.example/1`, location: "Ho Chi Minh", description: "Kubernetes" }),
    );
    await Promise.all(saves);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM jobs");
    expect(rows[0].n).toBe(1);
  });

  it("keeps the first source's text when another board words it differently", async () => {
    const a = { ...base, source: "itviec", externalId: "1", url: "https://itviec.com/1", location: "Ho Chi Minh", description: "Text A Kubernetes" };
    const b = { ...a, source: "topdev", externalId: "2", url: "https://topdev.vn/2", description: "Text B Kubernetes" };
    await store.savePosting(a);
    await store.savePosting(b);
    expect((await store.savePosting(b)).status).toBe("unchanged");
    const { rows } = await pool.query("SELECT description FROM jobs");
    expect(rows[0].description).toBe("Text A Kubernetes");
  });

  it("does not close a job that another board still lists", async () => {
    const a = { ...base, source: "itviec", externalId: "1", url: "https://itviec.com/1", location: "Ho Chi Minh", description: "Kubernetes" };
    await store.savePosting(a);
    await store.savePosting({ ...a, source: "linkedin", externalId: "9", url: "https://www.linkedin.com/jobs/view/9", closed: true });
    const { rows } = await pool.query("SELECT closed_at FROM jobs");
    expect(rows[0].closed_at).toBeNull();
  });

  it("reopens a closed posting that a search lists again", async () => {
    const a = { ...base, source: "linkedin", externalId: "7", url: "https://www.linkedin.com/jobs/view/7", location: "Ho Chi Minh", description: "Kubernetes" };
    await store.savePosting(a);
    await pool.query("UPDATE jobs SET closed_at = now()");
    expect(await store.markSeen("linkedin", ["7"])).toEqual([]);
    const { rows } = await pool.query("SELECT closed_at FROM jobs");
    expect(rows[0].closed_at).toBeNull();
  });

  it("gives board postings a month and career postings a week before closing", async () => {
    const board = { ...base, source: "linkedin", externalId: "7", url: "https://www.linkedin.com/jobs/view/7", location: "Ho Chi Minh", title: "DevOps Engineer", description: "Kubernetes" };
    const career = { ...base, externalId: "c1", url: "https://acme.vn/jobs/1", location: "Ho Chi Minh", title: "Platform Engineer", description: "Kubernetes" };
    await store.savePosting(board);
    await store.savePosting(career);
    await pool.query("UPDATE jobs SET last_seen_at = now() - interval '10 days'");
    expect(await store.closeStale()).toBe(1);
    const { rows } = await pool.query("SELECT title FROM jobs WHERE closed_at IS NULL");
    expect(rows.map((r) => r.title)).toEqual(["DevOps Engineer"]);
  });

  it("keeps postings of an unchanged career page open", async () => {
    const career = { ...base, externalId: "c1", url: "https://acme.vn/jobs/1", location: "Ho Chi Minh", description: "Kubernetes" };
    await store.savePosting(career);
    await pool.query("UPDATE jobs SET last_seen_at = now() - interval '8 days'; UPDATE job_sources SET last_seen_at = now() - interval '8 days'");
    const { rows: c } = await pool.query("SELECT company_id FROM jobs");
    await store.touchCareerPostings(Number(c[0].company_id), "www.acme.vn");
    expect(await store.closeStale()).toBe(0);
  });

  it("keeps a noted posting on rescoring and does not block removed ones for a month", async () => {
    const kept = { ...base, source: "itviec", externalId: "1", url: "https://itviec.com/1", location: "Ho Chi Minh", title: "DevOps Engineer", description: "Kubernetes" };
    const other = { ...kept, externalId: "2", url: "https://itviec.com/2", title: "DevOps Lead", companyName: "Beta" };
    await store.savePosting(kept);
    await store.savePosting(other);
    await pool.query("UPDATE applications SET note = 'call them' WHERE job_id = 1");
    const { savePrefs, DEFAULT_PREFS } = await import("../src/settings.js");
    await savePrefs({ ...DEFAULT_PREFS, keywords: ["Accountant"] });
    await store.rescoreAll();
    const { rows } = await pool.query("SELECT title FROM jobs ORDER BY id");
    expect(rows.map((r) => r.title)).toEqual(["DevOps Engineer"]);
    const { rows: rej } = await pool.query("SELECT count(*)::int AS n FROM rejected_postings");
    expect(rej[0].n).toBe(0);
    expect(await store.markSeen("itviec", ["2"])).toEqual(["2"]);
    await savePrefs(DEFAULT_PREFS);
  });
});

afterAll(async () => pool.end());
