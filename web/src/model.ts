// Display facts derived from API data: labels, salary text, places, ages, tiles. One place so every screen agrees.
import type { PostingView } from "./api";
import type { Prefs } from "../../src/prefs";
import { BASE_SCORE, weighted, type Category, type Weights } from "../../src/score-weights";

export const STATUS_LABEL: Record<string, string> = {
  new: "New", interested: "Interested", applied: "Applied", interviewing: "Interviewing", offer: "Offer", skipped: "Skipped",
};
export const STATUS_COLOR: Record<string, string> = {
  New: "var(--accent)", Interested: "var(--info)", Applied: "var(--info)", Interviewing: "var(--warn)", Offer: "var(--ok)", Skipped: "var(--ink3)", Closed: "var(--ink3)",
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TZ = "Asia/Ho_Chi_Minh";

export function dayMonth(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "numeric" }).formatToParts(d);
  return `${parts.find((p) => p.type === "day")!.value} ${MON[Number(parts.find((p) => p.type === "month")!.value) - 1]}`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

export function daysAgo(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}

// "5 h", "1 day", "9 days", "6 months"
export function ageText(iso: string, now: Date): string {
  const hours = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `${Math.floor(hours)} h`;
  const days = Math.floor(hours / 24);
  if (days < 45) return days === 1 ? "1 day" : `${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

// When the posting appeared: the source's own date when it has one, otherwise when we first saw it.
export const postedIso = (p: PostingView) => p.postedAt ?? p.firstSeen;
// What counts as "new" for the Inbox: first seen, or seen again after being closed.
export const freshIso = (p: PostingView) => (p.repostedAt && p.repostedAt > p.firstSeen ? p.repostedAt : p.firstSeen);

export function salaryText(p: PostingView): string | null {
  const { salaryMin: min, salaryMax: max, currency } = p;
  if (min === null && max === null) return null;
  const f = (v: number) => (currency === "USD" ? `$${v.toLocaleString("en-US")}` : `${Math.round(v / 1_000_000)}M`);
  const suffix = currency === "USD" ? "" : " VND";
  if (min !== null && max !== null) return `${f(min)}–${currency === "USD" ? max.toLocaleString("en-US") : f(max)}${suffix}`;
  return max !== null ? `Up to ${f(max)}${suffix}` : `From ${f(min!)}${suffix}`;
}

export function salaryMillionVnd(p: PostingView): { lo: number; hi: number } | null {
  const k = p.currency === "USD" ? 26_000 / 1_000_000 : 1 / 1_000_000;
  if (p.salaryMin === null && p.salaryMax === null) return null;
  const lo = (p.salaryMin ?? p.salaryMax!) * k;
  const hi = (p.salaryMax ?? p.salaryMin!) * k;
  // A minimum above the maximum is a misread range ("$164,200 - $295,600" read as 64,200–295); it has no place on the axis.
  if (lo > hi) return null;
  return { lo, hi };
}

export const MODE_LABEL: Record<string, string> = { onsite: "At office", hybrid: "Hybrid", remote: "Remote" };

export function district(location: string): string {
  const q = /(?:quận|district)\s*(\d{1,2})/i.exec(location);
  if (q) return `District ${q[1]}`;
  if (/thủ đức|thu duc/i.test(location)) return "Thu Duc";
  if (/h[oồ] ch[ií] minh|hcm|sài gòn|saigon/i.test(location)) return "Ho Chi Minh";
  if (/hà nội|ha noi|hanoi/i.test(location)) return "Ha Noi";
  return location.split(/[·,]/)[0]?.trim() || "Ho Chi Minh";
}

export function place(p: PostingView): string {
  const mode = MODE_LABEL[p.workMode];
  return [mode, district(p.location)].filter(Boolean).join(" · ");
}

export function sourceText(p: PostingView): string {
  const base = p.sources.length > 1 ? `${p.sources.length} sources` : (p.sources[0]?.name ?? "");
  return base + (p.repostedAt ? " · Reposted" : "");
}

const SKIP_WORDS = new Set(["công", "ty", "tnhh", "cổ", "phần", "thương", "mại", "dịch", "vụ", "tổng", "the", "company", "jsc", "ltd", "co.,", "ngân", "hàng"]);

export function initial(company: string): string {
  const words = company.split(/\s+/).filter((w) => !SKIP_WORDS.has(w.toLowerCase()));
  return ((words[0] ?? company)[0] ?? "?").toUpperCase();
}

export function tile(key: string): { tileBg: string; tileInk: string } {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const n = (h % 6) + 1;
  return { tileBg: `var(--t${n})`, tileInk: `var(--t${n}i)` };
}

export function scoreColor(score: number, prefs: Prefs): string {
  return score >= prefs.topMin ? "var(--acc-ink)" : "var(--ink)";
}

export function chips(p: PostingView, n = 3): { sign: string; t: string; col: string }[] {
  return p.reasons.slice(0, n).map((r) => ({ sign: r.points > 0 ? "+" : "−", t: r.label, col: r.points > 0 ? "var(--ok)" : "var(--warn)" }));
}

export const isOpen = (p: PostingView) => !p.closedAt;

// The Inbox: untriaged, open, recent, and either above the minimum or from a watched company.
export function inInbox(p: PostingView, prefs: Prefs, watched: Set<string>, now: Date): boolean {
  if (p.status !== "new" || p.closedAt) return false;
  if (daysAgo(freshIso(p), now) > prefs.newDays) return false;
  return p.score >= prefs.inboxMin || watched.has(p.companyKey);
}

// Pipeline column of a tracked posting; untriaged postings are not on the pipeline.
export function stage(p: PostingView): string | null {
  if (p.status === "new") return null;
  if (p.status === "skipped") return "Skipped";
  if (p.closedAt) return "Closed";
  return STATUS_LABEL[p.status];
}

export function statusLabel(p: PostingView): string {
  return STATUS_LABEL[p.status] ?? p.status;
}

export const LEVEL_LABEL: Record<string, string> = {
  intern: "Intern", junior: "Junior level", middle: "Middle level", senior: "Senior", lead: "Lead", manager: "Manager",
};

export const ENGLISH_LABEL: Record<string, string> = { fluent: "Fluent English required", good: "Good English required", basic: "English mentioned" };

const CAT_LABEL: Record<Category, string> = { salary: "Salary", stack: "Stack", level: "Level", english: "English", benefits: "Benefits", other: "Work mode", learned: "Your decisions", trust: "Trust" };

// "Why this score": the starting point, then each category's weighted total with the reasons behind it.
export function breakdown(p: PostingView, weights: Weights): { label: string; note: string; w: number }[] {
  const rows: { label: string; note: string; w: number }[] = [{ label: "Starting point", note: "every posting starts here", w: BASE_SCORE }];
  const order: Category[] = ["stack", "salary", "level", "benefits", "english", "other", "learned", "trust"];
  for (const cat of order) {
    const rs = p.reasons.filter((r) => r.cat === cat);
    if (!rs.length) continue;
    rows.push({ label: CAT_LABEL[cat], note: rs.map((r) => r.label).join(", "), w: rs.reduce((s, r) => s + weighted(r, weights), 0) });
  }
  return rows;
}

export function rescore(p: PostingView, weights: Weights): number {
  return Math.max(0, Math.min(100, p.reasons.reduce((s, r) => s + weighted(r, weights), BASE_SCORE)));
}
