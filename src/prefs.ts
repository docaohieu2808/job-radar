// The owner's preferences and their defaults. Pure data, shared by the crawler and the web screens.
import { DEFAULT_WEIGHTS, type Weights } from "./score-weights.js";

export type Prefs = {
  weights: Weights;
  // A posting enters the Inbox from this score (watchlist companies always do).
  inboxMin: number;
  // Scores from here are highlighted as top matches.
  topMin: number;
  // A posting is kept when its title contains any of these.
  keywords: string[];
  modes: { remote: boolean; hybrid: boolean; onsite: boolean };
  // How long an untriaged posting stays in the Inbox.
  newDays: number;
  defaultSort: "match" | "newest";
};

export const DEFAULT_PREFS: Prefs = {
  weights: DEFAULT_WEIGHTS,
  inboxMin: 60,
  topMin: 85,
  keywords: [
    "DevOps", "DevSecOps", "MLOps", "SRE", "Site Reliability", "Platform Engineer", "Cloud Engineer", "Cloud DevOps",
    "Infrastructure", "System Engineer", "System Admin", "Hạ tầng", "Vận hành", "Kỹ sư hệ thống",
  ],
  modes: { remote: true, hybrid: true, onsite: true },
  newDays: 14,
  defaultSort: "match",
};
