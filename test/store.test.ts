// Dedupe and repost behaviour against a real database (TEST_DATABASE_URL).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = testUrl ?? "postgres://unused";
const { pool } = await import("../src/db.js");
const { migrate } = await import("../src/migrate.js");
const { savePosting, markSeen, closeStale } = await import("../src/store.js");

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
    await pool.query("TRUNCATE jobs, job_sources, applications RESTART IDENTITY CASCADE");
  });
  afterAll(async () => pool.end());

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

  it("reports which listed ids are new and closes postings unseen for a week", async () => {
    await savePosting(base);
    expect(await markSeen("itviec", ["5841", "7000"])).toEqual(["7000"]);
    await pool.query("UPDATE jobs SET last_seen_at = now() - interval '8 days'");
    expect(await closeStale()).toBe(1);
  });
});
