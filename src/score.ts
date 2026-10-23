// Match score 0–100 from the owner's criteria. Every point carries a reason, shown on the web screens.
import { OWNER_STACK, type Facts } from "./extract.js";
import { DEFAULT_WEIGHTS, scoreFromReasons, type Category, type Reason, type Weights } from "./score-weights.js";

export type { Reason };
export type Score = { score: number; reasons: Reason[] };

const VND_PER_USD = 26_000;

export function salaryInMillionVnd(facts: Facts): number | null {
  const s = facts.salary;
  if (!s) return null;
  const top = s.max ?? s.min;
  if (top === null) return null;
  return (s.currency === "USD" ? top * VND_PER_USD : top) / 1_000_000;
}

// `extra` carries reasons computed elsewhere: what was learned from the owner's triage.
export function scorePosting(facts: Facts, weights: Weights = DEFAULT_WEIGHTS, extra: Reason[] = []): Score {
  const reasons: Reason[] = [...extra];
  let cat: Category = "salary";
  const add = (points: number, label: string) => points !== 0 && reasons.push({ points, label, cat });

  const salary = salaryInMillionVnd(facts);
  if (salary !== null) {
    if (salary >= 35) add(15, `Salary up to ${Math.round(salary)}M`);
    else if (salary >= 25) add(10, `Salary up to ${Math.round(salary)}M`);
    else if (salary < 18) add(-10, `Salary up to ${Math.round(salary)}M`);
  }

  cat = "stack";
  const have = facts.stack.filter((s) => OWNER_STACK.has(s));
  const gap = facts.stack.filter((s) => !OWNER_STACK.has(s));
  for (const skill of have.slice(0, 5)) add(4, skill);
  for (const skill of gap.slice(0, 3)) add(-3, `${skill} gap`);
  // Nothing from the DevOps toolbox named at all: usually a different job with an overlapping title.
  if (facts.stack.length === 0) add(-15, "No DevOps stack named");

  cat = "level";
  const levelPoints: Record<Facts["level"], number> = {
    middle: 10, junior: -5, senior: -8, lead: -15, manager: -20, intern: -25, unknown: 0,
  };
  const levelLabel: Record<Facts["level"], string> = {
    middle: "Middle level", junior: "Junior level", senior: "Senior", lead: "Lead", manager: "Manager", intern: "Intern", unknown: "",
  };
  add(levelPoints[facts.level], levelLabel[facts.level]);
  if (facts.years !== null && facts.years >= 5 && facts.level !== "senior") add(-8, `${facts.years}+ yrs`);

  cat = "english";
  if (facts.english === "fluent") add(-6, "Fluent English");
  else if (facts.english === "good") add(-3, "Good English");
  if (facts.vietnameseText) add(3, "Vietnamese posting");
  if (facts.foreignLanguage) add(-25, `${facts.foreignLanguage} required`);

  cat = "benefits";
  if (facts.certSupport) add(12, "Cert sponsorship");
  if (facts.abroad) add(5, "Onsite abroad");
  cat = "other";
  if (facts.workMode === "remote") add(5, "Remote");
  else if (facts.workMode === "hybrid") add(3, "Hybrid");

  reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return { score: scoreFromReasons(reasons, weights), reasons };
}
