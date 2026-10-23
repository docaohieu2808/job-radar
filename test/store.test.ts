// Dedupe and repost behaviour against a real database (TEST_DATABASE_URL).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = testUrl ?? "postgres://unused";
const { pool } = await import("../src/db.js");
const { migrate } = await import("../src/migrate.js");
const { savePosting, markSeen, closeStale, rescoreAll } = await import("../src/store.js");
const { savePrefs, DEFAULT_PREFS } = await import("../src/settings.js");

const base = {
  source: "itviec", externalId: "5841", url: "https://itviec.com/it-jobs/x-5841", companyName: "Endava Việt Nam",
  title: "Cloud Native DevOps Engineer", location: "Ho Chi Minh", description: "Docker, Kubernetes, GitLab. Hybrid.",
};

describe.skipIf(!testUrl)("savePosting", () => {
  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate();
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE jobs, job_sources, applications, rejected_postings, settings RESTART IDENTITY CASCADE");
  });

  it("creates a job once and then only touches it", async () => {
    expect((await savePosting(base)).status).toBe("new");
    expect((await savePosting(base)).status).toBe("unchanged");
    expect((await savePosting({ ...base, description: base.description + " Terraform." })).status).toBe("updated");
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM jobs");
    expect(rows[0].n).toBe(1);
  });

  it("merges the same posting from another board", async () => {
    await savePosting(base);
    await savePosting({ ...base, source: "linkedin", externalId: "999", url: "https://www.linkedin.com/jobs/view/999", companyName: "Endava Vietnam" });
    const { rows } = await pool.query("SELECT (SELECT count(*)::int FROM jobs) AS jobs, (SELECT count(*)::int FROM job_sources) AS sources");
    expect(rows[0]).toEqual({ jobs: 1, sources: 2 });
  });

  it("drops irrelevant titles and other cities", async () => {
    expect((await savePosting({ ...base, title: "Accountant" })).status).toBe("skipped");
    expect((await savePosting({ ...base, externalId: "1", location: "Cầu Giấy, Hà Nội", description: "Onsite" })).status).toBe("skipped");
  });

  it("marks a closed posting and treats its return as a repost", async () => {
    await savePosting({ ...base, closed: true });
    const back = await savePosting(base);
    expect(back.status).toBe("reposted");
  });

  it("does not send the crawler back to a rejected posting", async () => {
    await savePosting({ ...base, externalId: "8000", title: "Accountant" });
    expect(await markSeen("itviec", ["8000", "8001"])).toEqual(["8001"]);
  });

  it("removes untriaged postings the current filters no longer keep, and keeps triaged ones", async () => {
    const dropped = await savePosting(base);
    const triaged = await savePosting({ ...base, externalId: "9", title: "Platform Engineer", companyName: "Other" });
    await pool.query("UPDATE applications SET status = 'applied' WHERE job_id = $1", [triaged.jobId]);
    await savePrefs({ ...DEFAULT_PREFS, keywords: ["SRE"] });
    await rescoreAll();
    const { rows } = await pool.query("SELECT id FROM jobs ORDER BY id");
    expect(rows.map((r) => r.id)).toEqual([triaged.jobId]);
    expect(await markSeen("itviec", [base.externalId])).toEqual([]);
    await savePrefs(DEFAULT_PREFS);
    expect(dropped.status).toBe("new");
  });

  it("reports which listed ids are new and closes postings unseen for a week", async () => {
    await savePosting(base);
    expect(await markSeen("itviec", ["5841", "7000"])).toEqual(["7000"]);
    await pool.query("UPDATE jobs SET last_seen_at = now() - interval '8 days'");
    expect(await closeStale()).toBe(1);
  });
});

describe.skipIf(!testUrl)("one-week run", () => {
  it("records today and gives a verdict only after seven days", async () => {
    const { recordDay, soakStatus } = await import("../src/soak.js");
    await pool.query("TRUNCATE daily_stats");
    await recordDay();
    expect((await soakStatus()).days).toBe(1);
    expect((await soakStatus()).done).toBe(false);
    for (let d = 1; d < 7; d++) {
      await pool.query(
        `INSERT INTO daily_stats (day, pages, tasks, errors, hosts_worked, busiest_tasks, linkedin_tasks, companies, career_found, postings)
         VALUES (current_date - $1::int, 100, 100, 1, 10, 20, 50, 1, 1, 1)`,
        [d],
      );
    }
    const soak = await soakStatus();
    expect(soak.done).toBe(true);
    expect(soak.checks.find((c) => c.label === "At least 1,000 hosts")?.ok).toBe(false);
    expect(soak.passed).toBe(false);
  });
});

afterAll(async () => pool.end());
