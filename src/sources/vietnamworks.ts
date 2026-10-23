// VietnamWorks search API (POST). Full postings come back in the search response.
import { fetchText } from "../http.js";
import { savePosting, type Posting } from "../store.js";
import { htmlToText } from "../extract.js";
import { HOUR, type Source } from "./types.js";

const URL_SEARCH = "https://ms.vietnamworks.com/job-search/v1.0/search";

type VnwJob = {
  jobId: number;
  jobTitle: string;
  companyName: string;
  jobUrl: string;
  salaryMin: number;
  salaryMax: number;
  salaryCurrency: string;
  prettySalary?: string;
  isSalaryVisible?: boolean;
  workingLocations?: { address?: string; cityName?: string }[];
  skills?: { skillName: string }[];
  benefits?: { benefitName?: string; benefitValue?: string }[];
  jobLevel?: string;
  approvedOn?: string;
  jobDescription?: string;
  jobRequirement?: string;
  yearsOfExperience?: number;
};

export function toPosting(j: VnwJob): Posting {
  const hasSalary = j.isSalaryVisible !== false && (j.salaryMin > 0 || j.salaryMax > 0);
  const unit = j.salaryCurrency === "VND" ? "" : " USD";
  const toText = (v: number) => (j.salaryCurrency === "VND" ? `${Math.round(v / 1_000_000)} triệu` : String(v));
  const salaryText = hasSalary
    ? j.salaryMin > 0 && j.salaryMax > 0 ? `${toText(j.salaryMin)} - ${toText(j.salaryMax)}${unit}` : `up to ${toText(j.salaryMax || j.salaryMin)}${unit}`
    : undefined;
  const locations = (j.workingLocations ?? []).map((l) => [l.address, l.cityName].filter(Boolean).join(", "));
  return {
    source: "vietnamworks",
    externalId: String(j.jobId),
    url: j.jobUrl,
    title: j.jobTitle,
    companyName: j.companyName,
    location: locations.join(" · "),
    tags: (j.skills ?? []).map((s) => s.skillName),
    salaryText,
    postedAt: j.approvedOn ? new Date(j.approvedOn) : null,
    description: [
      j.jobLevel ? `Level: ${j.jobLevel}` : "",
      j.yearsOfExperience ? `Experience: ${j.yearsOfExperience} years` : "",
      htmlToText(j.jobDescription ?? ""),
      htmlToText(j.jobRequirement ?? ""),
      ...(j.benefits ?? []).map((b) => `${b.benefitName ?? ""}: ${b.benefitValue ?? ""}`),
    ].filter(Boolean).join("\n"),
  };
}

export const vietnamworks: Source = {
  name: "vietnamworks",
  hostIntervalSeconds: { "ms.vietnamworks.com": 20 },
  seeds: ["devops", "sre", "platform engineer", "cloud engineer"].map((k, i) => ({
    kind: "vietnamworks-search", url: `${URL_SEARCH}?q=${encodeURIComponent(k)}`, priority: 10 + i * 5,
  })),
  handlers: {
    "vietnamworks-search": async (task) => {
      const query = new URL(task.url).searchParams.get("q") ?? "devops";
      const body = JSON.parse(
        await fetchText(URL_SEARCH, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://www.vietnamworks.com", accept: "application/json" },
          body: JSON.stringify({ userId: 0, query, filter: [], ranges: [], order: [], hitsPerPage: 50, page: 0 }),
        }),
      ) as { data: VnwJob[] };
      for (const job of body.data ?? []) await savePosting(toPosting(job));
      return { recrawlAfterSeconds: 12 * HOUR, fetched: 1 };
    },
  },
};
