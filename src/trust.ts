// Trust checks on top of the crawl: is a page really a posting, is a website really the company's, and is a
// posting a live direct opening or a stale or second-hand one. Pure functions, used by the crawler and the store.
import { normalizeKey } from "./normalize-key.js";
import type { Reason } from "./score-weights.js";

// --- Posting pages on company sites: how many of the usual posting sections the page has.
const POSTING_MARKERS = [
  /yêu cầu|requirements?|qualifications?/i, /quyền lợi|phúc lợi|benefits?|what we offer/i, /mô tả công việc|job description|responsibilities|trách nhiệm/i,
  /ứng tuyển|nộp hồ sơ|apply now|apply for this|gửi cv|send (your )?cv/i, /kinh nghiệm|experience/i, /mức lương|salary|thu nhập/i,
];

// "sure": three or more sections; "maybe": two (worth a second opinion); "no": fewer.
export function postingConfidence(text: string): "sure" | "maybe" | "no" {
  const n = POSTING_MARKERS.filter((m) => m.test(text)).length;
  return n >= 3 ? "sure" : n === 2 ? "maybe" : "no";
}

// --- Website match: evidence that a site belongs to the company it is filed under.
export function siteMatch(input: {
  companyName: string; website: string; websiteSource: string | null; pageText: string; emailDomains: string[];
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const host = new URL(input.website).hostname.replace(/^www\./, "");
  const key = normalizeKey(input.companyName).replace(/\s+/g, "");
  const label = host.split(".")[0].replace(/-/g, "");
  if (input.websiteSource === "owner") return { score: 100, reasons: ["you set it"] };
  if (label.length >= 3 && (key.includes(label) || label.includes(key.slice(0, Math.max(4, label.length))))) {
    score += 40;
    reasons.push("name in the address");
  }
  if (input.websiteSource === "topdev" || input.websiteSource === "vietnamworks") {
    score += 30;
    reasons.push(`listed by ${input.websiteSource === "topdev" ? "TopDev" : "VietnamWorks"}`);
  }
  if (input.emailDomains.some((d) => d === host || d.endsWith(`.${host}`))) {
    score += 30;
    reasons.push("same domain as the contact e-mail");
  }
  // The company's own name (its distinctive words) on the home page, e.g. in the footer.
  const words = normalizeKey(input.companyName).split(" ").filter((w) => w.length >= 4 && !GENERIC.has(w));
  const page = normalizeKey(input.pageText);
  if (words.length && words.every((w) => page.includes(w))) {
    score += 20;
    reasons.push("company name on the site");
  }
  if (/mã số thuế|\bmst\b|tax code|business registration/i.test(input.pageText)) {
    score += 10;
    reasons.push("tax code shown");
  }
  return { score: Math.min(100, score), reasons };
}

const GENERIC = new Set(["company", "limited", "technology", "technologies", "software", "solutions", "vietnam", "group", "corporation", "joint", "stock", "services"]);

export function siteMatchLabel(score: number | null): "high" | "medium" | "low" | null {
  if (score === null) return null;
  return score >= 60 ? "high" : score >= 30 ? "medium" : "low";
}

// --- Postings: stale, reposted, second-hand, or missing from the company's own careers page.
const RECRUITER = /careers\.co\b|\bjobs\s*$|headhunt|executive search|recruit(ment|ing)? (agency|solutions|services|partners?)|talent (solutions|partners?)|staffing|manpower|human resources? (solutions|services)|\bhr (solutions|services|consult\w*)|nhân lực|cung ứng nhân sự|giải pháp nhân sự|confidential|undisclosed|bảo mật thông tin/i;
// "Our client is hiring", not a menu item such as "Khách hàng của chúng tôi" (our customers page).
const FOR_A_CLIENT = /\b(our|on behalf of (our|a)) client(,| is| a| -)|khách hàng của chúng tôi (là|đang|cần|tuyển)|cho khách hàng (là|của)/i;

export type TrustInput = {
  companyName: string; description: string; firstSeenAt: Date; reposted: boolean; now: Date;
  sources: string[]; companyListsJobs: boolean; siteMatch: number | null;
};

export function trustReasons(p: TrustInput): Reason[] {
  const reasons: Reason[] = [];
  const days = Math.floor((p.now.getTime() - p.firstSeenAt.getTime()) / 86_400_000);
  if (days >= 45) reasons.push({ cat: "trust", points: -5, label: `Open ${days} days${p.reposted ? ", reposted" : ""}` });
  else if (p.reposted && days >= 14) reasons.push({ cat: "trust", points: -3, label: "Reposted" });
  if (RECRUITER.test(p.companyName) || FOR_A_CLIENT.test(p.description.slice(0, 600))) {
    reasons.push({ cat: "trust", points: -5, label: "Recruiter posting, employer not named" });
  }
  // A company whose own careers page lists openings, but not this one, three days after the board posted it.
  if (p.companyListsJobs && !p.sources.includes("career") && days >= 3) {
    reasons.push({ cat: "trust", points: -3, label: "Not on the company's own careers page" });
  }
  // Read from a website that may not be this company's at all.
  if (p.sources.length && p.sources.every((s) => s === "career") && p.siteMatch !== null && p.siteMatch < 30) {
    reasons.push({ cat: "trust", points: -5, label: "Website not confirmed as this company's" });
  }
  return reasons;
}
