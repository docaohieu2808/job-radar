// TopDev public API: one request returns full postings, so no per-posting fetch is needed.
import { fetchJson } from "../http.js";
import { saveOne, savePosting, type Posting } from "../store.js";
import { htmlToText } from "../extract.js";
import { HOUR, type Source } from "./types.js";

const FIELDS =
  "fields[job]=id,title,salary,detail_url,addresses,skills_arr,job_levels_str,job_types_str,published,company," +
  "responsibilities_original,requirements_original,benefits_original,experiences_str&fields[company]=display_name,website";

type TopDevJob = {
  id: number;
  title: string;
  detail_url: string;
  company?: { display_name?: string; website?: string };
  salary?: { min?: string; max?: string; currency?: string; is_negotiable?: string; value?: string | null };
  addresses?: { address_region_list?: string; sort_addresses?: string };
  skills_arr?: string[];
  job_levels_str?: string;
  experiences_str?: string;
  published?: { date?: string };
  responsibilities_original?: string;
  requirements_original?: string;
  benefits_original?: string | { value?: string }[];
};

// "07-10-2026" -> Date
function parseDate(d?: string): Date | null {
  const m = d && /^(\d{2})-(\d{2})-(\d{4})$/.exec(d);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00+07:00`) : null;
}

export function toPosting(j: TopDevJob): Posting {
  const s = j.salary;
  // Hidden salaries come back as "*"; only real numbers become salary text.
  const salaryText =
    s && s.min && s.min !== "*" && s.max && s.max !== "*" ? `${s.min} - ${s.max} ${s.currency === "USD" ? "USD" : "triệu"}` : (s?.value ?? undefined);
  return {
    source: "topdev",
    externalId: String(j.id),
    url: j.detail_url,
    title: j.title,
    companyName: j.company?.display_name ?? "",
    companyWebsite: { url: j.company?.website ?? null, source: "topdev" },
    location: j.addresses?.sort_addresses ?? j.addresses?.address_region_list ?? "",
    tags: j.skills_arr ?? [],
    salaryText: salaryText || undefined,
    postedAt: parseDate(j.published?.date),
    description: [
      j.job_levels_str ? `Level: ${j.job_levels_str}` : "",
      j.experiences_str ? `Experience: ${j.experiences_str}` : "",
      htmlToText(j.responsibilities_original ?? ""),
      htmlToText(j.requirements_original ?? ""),
      ...(Array.isArray(j.benefits_original) ? j.benefits_original.map((b) => htmlToText(b.value ?? "")) : [htmlToText(j.benefits_original ?? "")]),
    ].filter(Boolean).join("\n"),
  };
}

const search = (keyword: string) => `https://api.topdev.vn/td/v2/jobs/search/v2?keyword=${encodeURIComponent(keyword)}&page=1&${FIELDS}`;

export const topdev: Source = {
  name: "topdev",
  hostIntervalSeconds: { "api.topdev.vn": 20 },
  seeds: ["devops", "sre", "platform engineer", "cloud engineer", "devsecops"].map((k, i) => ({
    kind: "topdev-search", url: search(k), priority: 10 + i * 5,
  })),
  handlers: {
    "topdev-search": async (task) => {
      const body = await fetchJson<{ data: TopDevJob[] }>(task.url);
      for (const job of body.data ?? []) await saveOne(() => savePosting(toPosting(job)), job.detail_url);
      return { recrawlAfterSeconds: 12 * HOUR, fetched: 1 };
    },
  },
};
