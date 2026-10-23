// Shapes the API sends to the screens. Pure types, imported by both the server and the web build.
import type { Prefs } from "../prefs.js";
import type { Reason } from "../score-weights.js";

export type SourceHealth = {
  id: string;
  name: string;
  kind: string;
  note: string;
  status: "Healthy" | "Degraded" | "Blocked";
  lastRun: string | null;
  seen24h: number;
  errors: number;
  error: string | null;
  errorDetail: string | null;
  pausedUntil: string | null;
};

export type Usage = { pagesToday: number; linkedinToday: number; linkedinLimit: number; lastChecked: string | null };

export type PostingView = {
  id: number;
  company: string;
  companyKey: string;
  title: string;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  location: string;
  workMode: string;
  level: string;
  years: number | null;
  english: string;
  certSupport: boolean;
  have: string[];
  gap: string[];
  score: number;
  reasons: Reason[];
  excerpts: Record<string, string>;
  sources: { name: string; url: string; firstSeen: string; lastSeen: string }[];
  firstSeen: string;
  postedAt: string | null;
  repostedAt: string | null;
  closedAt: string | null;
  status: string;
  note: string | null;
  statusAt: string;
};

export type CompanyView = { key: string; name: string; watch: boolean };

export type StateView = {
  now: string;
  prefs: Prefs;
  postings: PostingView[];
  companies: CompanyView[];
  sources: SourceHealth[];
  usage: Usage;
};
