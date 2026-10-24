// Applicant tracking systems with public JSON: recognised from a link, then read through their API.
import { fetchJson, fetchText } from "../http.js";
import { htmlToText } from "../extract.js";

export type Ats = { kind: "greenhouse" | "lever" | "smartrecruiters" | "workday" | "ashby"; board: string; host?: string; site?: string };

// `company` is the employer's name as the ATS states it (Greenhouse), used to name companies found by board slug.
export type AtsJob = { id: string; title: string; url: string; location: string; description: string | null; detail?: () => Promise<string>; company?: string };

export function detectAts(link: string): Ats | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  const seg = u.pathname.split("/").filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(u.hostname)) {
    const board = u.hostname.startsWith("boards-api") ? seg[2] : (u.searchParams.get("for") ?? seg[0]);
    return board && board !== "embed" ? { kind: "greenhouse", board } : null;
  }
  if (u.hostname === "jobs.lever.co" && seg[0]) return { kind: "lever", board: seg[0] };
  if (u.hostname === "jobs.ashbyhq.com" && seg[0]) return { kind: "ashby", board: seg[0] };
  if (/^(careers|jobs)\.smartrecruiters\.com$/.test(u.hostname) && seg[0]) return { kind: "smartrecruiters", board: seg[0] };
  const wd = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i.exec(u.hostname);
  if (wd) {
    const site = seg.filter((s) => !/^[a-z]{2}-[A-Z]{2}$/.test(s))[0];
    return site ? { kind: "workday", board: wd[1], host: u.hostname, site } : null;
  }
  return null;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// Workday has no full listing; it is searched with a few DevOps-family words.
const WORKDAY_SEARCHES = ["devops", "sre", "cloud", "platform"];
// Paging caps: enough for any board we read (the largest Workday tenants list a few dozen matches per word),
// small enough that one giant board cannot hold a worker lane for minutes.
const WORKDAY_MAX_PER_SEARCH = 100;
const SMARTRECRUITERS_MAX = 1000;

export async function listAtsJobs(ats: Ats): Promise<AtsJob[]> {
  if (ats.kind === "greenhouse") {
    // The listing without job bodies is small even for boards with hundreds of roles; bodies are fetched only for
    // the roles that pass the title and place filters.
    const board = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ats.board)}`;
    const body = await fetchJson<{ jobs: { id: number; title: string; absolute_url: string; location?: { name?: string }; company_name?: string }[] }>(`${board}/jobs`);
    return body.jobs.map((j) => ({
      id: String(j.id), title: j.title, url: j.absolute_url, location: j.location?.name ?? "", description: null, company: j.company_name,
      detail: async () => htmlToText(decode((await fetchJson<{ content?: string }>(`${board}/jobs/${j.id}`)).content ?? "")),
    }));
  }
  if (ats.kind === "ashby") {
    const body = await fetchJson<{ jobs: { id: string; title: string; jobUrl: string; location?: string; isRemote?: boolean; secondaryLocations?: { location?: string }[]; descriptionPlain?: string; isListed?: boolean }[] }>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(ats.board)}`,
    );
    return body.jobs.filter((j) => j.isListed !== false).map((j) => {
      const places = [j.location ?? "", ...(j.secondaryLocations ?? []).map((l) => l.location ?? "")].filter(Boolean);
      const location = [...new Set(places)].join("; ");
      return {
        id: j.id, title: j.title, url: j.jobUrl, description: j.descriptionPlain ?? "",
        // Ashby marks remote roles and gives the country or city they are tied to; that place is kept in the text.
        location: j.isRemote && !/remote/i.test(location) ? (location ? `Remote (${location})` : "Remote") : location,
      };
    });
  }
  if (ats.kind === "lever") {
    const body = await fetchJson<{ id: string; text: string; hostedUrl: string; categories?: { location?: string }; descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string }[]>(
      `https://api.lever.co/v0/postings/${encodeURIComponent(ats.board)}?mode=json`,
    );
    return body.map((j) => ({
      id: j.id, title: j.text, url: j.hostedUrl, location: j.categories?.location ?? "",
      description: [j.descriptionPlain ?? "", ...(j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain ?? ""].join("\n"),
    }));
  }
  if (ats.kind === "smartrecruiters") {
    type SrPosting = { id: string; name: string; ref: string; location?: { city?: string; country?: string; remote?: boolean } };
    // 100 per page, following totalFound; capped so one huge board cannot eat the run.
    const postings: SrPosting[] = [];
    for (let offset = 0; offset < SMARTRECRUITERS_MAX; offset += 100) {
      const page = await fetchJson<{ totalFound?: number; content: SrPosting[] }>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(ats.board)}/postings?limit=100&offset=${offset}`,
      );
      postings.push(...page.content);
      if (page.content.length < 100 || offset + 100 >= (page.totalFound ?? 0)) break;
    }
    return postings.map((j) => ({
      id: j.id, title: j.name, url: `https://jobs.smartrecruiters.com/${ats.board}/${j.id}`,
      location: [j.location?.city, j.location?.country, j.location?.remote ? "Remote" : ""].filter(Boolean).join(", "),
      description: null,
      detail: async () => {
        const d = await fetchJson<{ jobAd?: { sections?: Record<string, { text?: string }> } }>(j.ref);
        return Object.values(d.jobAd?.sections ?? {}).map((s) => htmlToText(s.text ?? "")).join("\n");
      },
    }));
  }
  const base = `https://${ats.host}/wday/cxs/${ats.board}/${ats.site}`;
  const seen = new Map<string, AtsJob>();
  for (const searchText of WORKDAY_SEARCHES) {
    // Workday pages 20 at a time and reports `total`; follow it up to WORKDAY_MAX_PER_SEARCH.
    let total = Infinity;
    for (let offset = 0; offset < Math.min(total, WORKDAY_MAX_PER_SEARCH); offset += 20) {
      const body = JSON.parse(
        await fetchText(`${base}/jobs`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText }) }),
      ) as { total?: number; jobPostings?: { title: string; externalPath: string; locationsText?: string }[] };
      if (typeof body.total === "number") total = body.total;
      if (!body.jobPostings?.length) break;
      for (const j of body.jobPostings) {
        if (seen.has(j.externalPath)) continue;
        seen.set(j.externalPath, {
          id: j.externalPath, title: j.title, url: `https://${ats.host}/${ats.site}${j.externalPath}`, location: j.locationsText ?? "", description: null,
          detail: async () => {
            const d = await fetchJson<{ jobPostingInfo?: { jobDescription?: string; location?: string } }>(`${base}${j.externalPath}`);
            return htmlToText(d.jobPostingInfo?.jobDescription ?? "");
          },
        });
      }
    }
  }
  return [...seen.values()];
}
