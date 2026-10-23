// International remote job boards: Himalayas (JSON API), We Work Remotely (RSS), Working Nomads (JSON), and the
// published APIs of Remotive, RemoteOK and Jobicy. Those three disallow crawling their pages in robots.txt but offer
// the API for reuse with attribution; only the documented API is called, twice a day, and every posting links back
// to its page on the board. Only remote roles open to someone in Vietnam are kept, and every company they
// name joins the company registry with its website, so its own career page or ATS board is then read daily too.
import * as cheerio from "cheerio";
import { fetchJson, fetchText } from "../http.js";
import { savePosting, type Posting } from "../store.js";
import { htmlToText } from "../extract.js";
import { ensureCompany, websiteFromLinks, websiteFromText } from "../companies.js";
import { detectAts } from "./ats.js";
import { addCareerPage } from "./career.js";
import { HOUR, type Source } from "./types.js";

const REMOTE = ["Remote"];

// The first applicant-tracking board linked from a posting ("Apply at boards.greenhouse.io/acme").
export function atsLinkIn(html: string): string | null {
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+/g)) if (detectAts(m[0])) return m[0];
  return null;
}

// --- Himalayas: `country=Vietnam` returns only roles whose location restrictions include Vietnam (or none).
type HimalayasJob = {
  title: string; companyName: string; guid: string; description: string; pubDate: string;
  locationRestrictions: string[]; minSalary: number | null; maxSalary: number | null; currency: string | null; seniority: string[];
};

export function himalayasPosting(j: HimalayasJob): Posting {
  const region = j.locationRestrictions.length ? j.locationRestrictions.join(", ") : "Worldwide";
  const salary = j.maxSalary && j.currency ? `${j.minSalary ?? ""} - ${j.maxSalary} ${j.currency}` : undefined;
  return {
    source: "himalayas",
    externalId: j.guid,
    url: j.guid,
    title: j.title,
    companyName: j.companyName,
    companyWebsite: { url: websiteFromLinks(j.companyName, j.description), source: "remote board" },
    companyAts: atsLinkIn(j.description),
    location: `Remote (${region})`,
    tags: [...REMOTE, ...(j.seniority ?? [])],
    // Annual figures in foreign currency would read as monthly VND; they stay in the description instead.
    description: [htmlToText(j.description), salary ? `Salary (annual): ${salary}` : ""].filter(Boolean).join("\n"),
    postedAt: Number(j.pubDate) ? new Date(Number(j.pubDate) * 1000) : null,
  };
}

const himalayasSearch = (q: string) => `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&country=Vietnam&sort=recent`;

// --- We Work Remotely: the DevOps and Sysadmin category feed; each item states its region.
export function parseWwr(xml: string): Posting[] {
  const $ = cheerio.load(xml, { xml: true });
  return $("item")
    .map((_, el) => {
      const item = $(el);
      const [company, ...rest] = item.find("title").first().text().split(":");
      const html = item.find("description").first().text();
      const region = item.find("region").first().text().trim();
      const link = item.find("link").first().text().trim() || item.find("guid").first().text().trim();
      return {
        source: "weworkremotely",
        externalId: link,
        url: link,
        title: rest.join(":").trim(),
        companyName: company.trim(),
        companyWebsite: { url: /URL:/.test(html) ? websiteFromText(html.slice(html.indexOf("URL:"))) : null, source: "remote board" },
        companyAts: atsLinkIn(html),
        location: `Remote (${region || "Worldwide"})`,
        tags: [...REMOTE, ...item.find("skills").first().text().split(/,| and /).map((s) => s.trim()).filter(Boolean)],
        description: htmlToText(html),
        postedAt: item.find("pubDate").first().text() ? new Date(item.find("pubDate").first().text()) : null,
      } satisfies Posting;
    })
    .get();
}

// --- Working Nomads: one feed of recent remote jobs; the systems and DevOps ones are kept.
type NomadsJob = { url: string; title: string; description: string; company_name: string; category_name: string; tags: string; location: string; pub_date: string };

export function nomadsPosting(j: NomadsJob): Posting {
  return {
    source: "workingnomads",
    externalId: j.url,
    url: j.url,
    title: j.title,
    companyName: j.company_name,
    companyWebsite: { url: websiteFromLinks(j.company_name, j.description), source: "remote board" },
    companyAts: atsLinkIn(j.description),
    location: `Remote (${j.location || "Worldwide"})`,
    tags: [...REMOTE, ...j.tags.split(",").map((s) => s.trim()).filter(Boolean)],
    description: htmlToText(j.description),
    postedAt: j.pub_date ? new Date(j.pub_date) : null,
  };
}

// --- Remotive, RemoteOK, Jobicy: their documented APIs, one request per run.
type RemotiveJob = { id: number; url: string; title: string; company_name: string; tags: string[]; publication_date: string; candidate_required_location: string; description: string };

export function remotivePosting(j: RemotiveJob): Posting {
  return {
    source: "remotive", externalId: String(j.id), url: j.url, title: j.title, companyName: j.company_name,
    companyWebsite: { url: websiteFromLinks(j.company_name, j.description), source: "remote board" },
    companyAts: atsLinkIn(j.description),
    location: `Remote (${j.candidate_required_location || "Worldwide"})`,
    tags: [...REMOTE, ...(j.tags ?? [])], description: htmlToText(j.description),
    postedAt: j.publication_date ? new Date(j.publication_date) : null,
  };
}

type RemoteOkJob = { id: string; url: string; position: string; company: string; tags: string[]; location: string; description: string; date: string };

export function remoteOkPosting(j: RemoteOkJob): Posting {
  return {
    source: "remoteok", externalId: String(j.id), url: j.url, title: j.position, companyName: j.company,
    companyWebsite: { url: websiteFromLinks(j.company, j.description), source: "remote board" },
    companyAts: atsLinkIn(j.description),
    // RemoteOK leaves the field empty for worldwide roles.
    location: `Remote (${j.location || "Worldwide"})`,
    tags: [...REMOTE, ...(j.tags ?? [])], description: htmlToText(j.description),
    postedAt: j.date ? new Date(j.date) : null,
  };
}

type JobicyJob = { id: string | number; url: string; jobTitle: string; companyName: string; jobGeo: string; jobLevel: string; jobDescription: string; pubDate: string };

export function jobicyPosting(j: JobicyJob): Posting {
  return {
    source: "jobicy", externalId: String(j.id), url: j.url, title: j.jobTitle, companyName: j.companyName,
    companyWebsite: { url: websiteFromLinks(j.companyName, j.jobDescription), source: "remote board" },
    companyAts: atsLinkIn(j.jobDescription),
    location: `Remote (${j.jobGeo || "Worldwide"})`,
    tags: [...REMOTE, j.jobLevel].filter(Boolean), description: htmlToText(j.jobDescription),
    postedAt: j.pubDate ? new Date(j.pubDate) : null,
  };
}

// Every company a remote board names is a company that hires remotely, whatever this role is: it joins the
// registry with its website or ATS board, so its future DevOps openings are found on its own career page.
// The posting itself goes through the store, whose place rule drops roles limited to regions elsewhere.
async function saveAll(postings: Posting[]): Promise<void> {
  for (const p of postings) {
    if (p.companyName && (p.companyWebsite?.url || p.companyAts)) {
      const id = await ensureCompany(p.companyName, p.companyWebsite?.url ? p.companyWebsite : null);
      const ats = p.companyAts ? detectAts(p.companyAts) : null;
      if (ats && p.companyAts) await addCareerPage(id, p.companyAts, ats, 0);
    }
    await savePosting(p);
  }
}

export const remoteBoards: Source = {
  name: "remote-boards",
  hostIntervalSeconds: { "himalayas.app": 30, "weworkremotely.com": 60, "www.workingnomads.com": 60, "remotive.com": 120, "remoteok.com": 120, "jobicy.com": 120 },
  seeds: [
    ...["devops", "site reliability", "platform engineer", "cloud engineer", "kubernetes", "infrastructure engineer"].map((q, i) => ({
      kind: "himalayas-search", url: himalayasSearch(q), priority: 25 + i * 3,
    })),
    { kind: "weworkremotely-search", url: "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss", priority: 30 },
    { kind: "workingnomads-search", url: "https://www.workingnomads.com/api/exposed_jobs/", priority: 35 },
    { kind: "remotive-search", url: "https://remotive.com/api/remote-jobs?category=devops", priority: 35 },
    { kind: "remoteok-search", url: "https://remoteok.com/api?tag=devops", priority: 35 },
    { kind: "jobicy-search", url: "https://jobicy.com/api/v2/remote-jobs?count=50&tag=devops", priority: 35 },
  ],
  handlers: {
    "himalayas-search": async (task) => {
      const body = await fetchJson<{ jobs: HimalayasJob[] }>(task.url);
      await saveAll((body.jobs ?? []).map(himalayasPosting));
      return { recrawlAfterSeconds: 12 * HOUR, fetched: 1 };
    },
    "weworkremotely-search": async (task) => {
      await saveAll(parseWwr(await fetchText(task.url)));
      return { recrawlAfterSeconds: 12 * HOUR, fetched: 1 };
    },
    "workingnomads-search": async (task) => {
      const jobs = await fetchJson<NomadsJob[]>(task.url);
      await saveAll(jobs.filter((j) => /administration|devops|system/i.test(j.category_name) || /devops|sre|platform|cloud|infra/i.test(j.title)).map(nomadsPosting));
      return { recrawlAfterSeconds: 12 * HOUR, fetched: 1 };
    },
    "remotive-search": async (task) => {
      await saveAll((await fetchJson<{ jobs: RemotiveJob[] }>(task.url)).jobs.map(remotivePosting));
      return { recrawlAfterSeconds: 12 * HOUR, fetched: 1 };
    },
    "remoteok-search": async (task) => {
      // The first element is the API's legal notice, not a job.
      const items = await fetchJson<(RemoteOkJob & { legal?: string })[]>(task.url);
      await saveAll(items.filter((j) => !j.legal && j.position).map(remoteOkPosting));
      return { recrawlAfterSeconds: 12 * HOUR, fetched: 1 };
    },
    "jobicy-search": async (task) => {
      await saveAll((await fetchJson<{ jobs: JobicyJob[] }>(task.url)).jobs.map(jobicyPosting));
      return { recrawlAfterSeconds: 12 * HOUR, fetched: 1 };
    },
  },
};
