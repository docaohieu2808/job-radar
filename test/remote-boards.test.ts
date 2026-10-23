import { describe, expect, it } from "vitest";
import { extractFacts, isWantedLocation } from "../src/extract.js";

process.env.DATABASE_URL ??= "postgres://unused";
const { himalayasPosting, jobicyPosting, nomadsPosting, parseWwr, remoteOkPosting } = await import("../src/sources/remote-boards.js");

const WWR = `<?xml version="1.0"?><rss><channel><item>
  <title>Aquifer: Senior DevOps Engineer</title>
  <region>Anywhere in the World</region>
  <skills>Kubernetes, Terraform and AWS</skills>
  <link>https://weworkremotely.com/remote-jobs/aquifer-senior-devops-engineer</link>
  <pubDate>Thu, 22 Oct 2026 10:00:00 +0000</pubDate>
  <description>&lt;p&gt;&lt;strong&gt;URL:&lt;/strong&gt; &lt;a href="https://aquifer.org/"&gt;https://aquifer.org/&lt;/a&gt;&lt;/p&gt;&lt;p&gt;Run our Kubernetes platform.&lt;/p&gt;</description>
</item><item>
  <title>Acme: DevOps Engineer</title>
  <region>USA Only</region>
  <link>https://weworkremotely.com/remote-jobs/acme-devops</link>
  <description>&lt;p&gt;Docker&lt;/p&gt;</description>
</item></channel></rss>`;

describe("remote boards", () => {
  it("reads We Work Remotely items with company, region and website", () => {
    const [a, b] = parseWwr(WWR);
    expect(a.companyName).toBe("Aquifer");
    expect(a.title).toBe("Senior DevOps Engineer");
    expect(a.companyWebsite?.url).toBe("https://aquifer.org");
    expect(a.location).toBe("Remote (Anywhere in the World)");
    const facts = extractFacts({ title: a.title, text: a.description, tags: a.tags });
    expect(facts.workMode).toBe("remote");
    expect(isWantedLocation(a.location, facts.workMode)).toBe(true);
    expect(isWantedLocation(b.location, "remote")).toBe(false);
  });

  it("keeps a remote-board posting remote when rescored from its stored fields", () => {
    const facts = extractFacts({ title: "Senior SRE - APAC", text: "We run Kubernetes in Singapore and Sydney.", tags: ["Kubernetes"], location: "Remote (Singapore, Vietnam)" });
    expect(facts.workMode).toBe("remote");
    expect(isWantedLocation("Remote (Singapore, Vietnam)", facts.workMode)).toBe(true);
  });

  it("maps a Himalayas job open to Vietnam and finds the site among its links", () => {
    const p = himalayasPosting({
      title: "Senior SRE - APAC", companyName: "Alpaca", guid: "https://himalayas.app/companies/alpaca/jobs/senior-sre-apac",
      description: '<p>Alpaca (<a href="https://alpaca.markets/about">about</a>) runs on <a href="https://himalayas.app/x">x</a></p>',
      pubDate: "1792779541", locationRestrictions: ["Singapore", "Vietnam"], minSalary: null, maxSalary: null, currency: null, seniority: ["Senior"],
    });
    expect(p.location).toBe("Remote (Singapore, Vietnam)");
    expect(p.companyWebsite?.url).toBe("https://alpaca.markets");
    expect(isWantedLocation(p.location, "remote")).toBe(true);
  });

  it("keeps a worldwide RemoteOK role and drops a USA-only Jobicy one", () => {
    const ok = remoteOkPosting({ id: "1", url: "https://remoteOK.com/remote-jobs/x", position: "Senior DevOps Engineer", company: "Lemon.io", tags: ["devops"], location: "", description: "<p>k8s</p>", date: "2026-10-22T12:58:28+00:00" });
    expect(ok.location).toBe("Remote (Worldwide)");
    expect(isWantedLocation(ok.location, "remote")).toBe(true);
    const usa = jobicyPosting({ id: 2, url: "https://jobicy.com/jobs/2", jobTitle: "SRE II", companyName: "Juniper Square", jobGeo: "USA", jobLevel: "Senior", jobDescription: "<p>x</p>", pubDate: "2026-10-23T13:48:16+00:00" });
    expect(isWantedLocation(usa.location, "remote")).toBe(false);
  });

  it("drops a Working Nomads role limited to a European time zone", () => {
    const p = nomadsPosting({ url: "https://www.workingnomads.com/job/go/1/", title: "Senior DevOps Engineer (Azure)", description: "<p>Azure</p>",
      company_name: "Acme", category_name: "Administration", tags: "devops,azure", location: "Time zone: CET (+/- 3 hours)", pub_date: "2026-10-22T10:00:00" });
    expect(isWantedLocation(p.location, "remote")).toBe(false);
  });
});
