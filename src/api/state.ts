// Everything the screens need in one read: postings with their sources and status, companies, source health.
// The owner has a few hundred postings at most, so one payload is simpler than paging.
import { active, loadLearned, MIN_LABELS } from "../learn.js";
import { pool } from "../db.js";
import { OWNER_STACK } from "../extract.js";
import { loadPrefs } from "../settings.js";
import { normalizeKey } from "../store.js";
import type { Reason } from "../score-weights.js";
import { sourceHealth } from "./sources-health.js";
import type { CompanyView, PostingView, StateView } from "./view-types.js";

export type { CompanyView, PostingView, StateView };

const SOURCE_NAMES: Record<string, string> = {
  linkedin: "LinkedIn",
  itviec: "ITviec",
  topdev: "TopDev",
  vietnamworks: "VietnamWorks",
  himalayas: "Himalayas",
  weworkremotely: "We Work Remotely",
  workingnomads: "Working Nomads",
  remotive: "Remotive",
  remoteok: "Remote OK",
  jobicy: "Jobicy",
  career: "Career page",
};

export function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? source;
}

type Row = {
  id: string; company_name: string; title: string; salary_min: string | null; salary_max: string | null; currency: string | null;
  location: string | null; work_mode: string | null; level: string | null; years: string | null; english_required: string | null;
  cert_support: boolean | null; stack: string[]; score: number; score_reasons: Reason[]; raw_excerpts: Record<string, string>;
  first_seen_at: Date; posted_at: Date | null; reposted_at: Date | null; closed_at: Date | null;
  status: string; note: string | null; status_at: Date;
  sources: { source: string; url: string; first_seen_at: string; last_seen_at: string }[];
};

export async function loadState(): Promise<StateView> {
  const prefs = await loadPrefs();
  const { rows } = await pool.query<Row>(`
    SELECT j.id, j.company_name, j.title, j.salary_min, j.salary_max, j.currency, j.location, j.work_mode, j.level, j.years,
           j.english_required, j.cert_support, j.stack, j.score, j.score_reasons, j.raw_excerpts,
           j.first_seen_at, j.posted_at, j.reposted_at, j.closed_at,
           a.status, a.note, a.updated_at AS status_at,
           (SELECT json_agg(json_build_object('source', s.source, 'url', s.url, 'first_seen_at', s.first_seen_at, 'last_seen_at', s.last_seen_at)
                            ORDER BY s.first_seen_at)
              FROM job_sources s WHERE s.job_id = j.id) AS sources
      FROM jobs j JOIN applications a ON a.job_id = j.id`);

  const postings = rows.map((r): PostingView => ({
    // bigserial arrives as a string from pg; the screens and URLs use numbers.
    id: Number(r.id),
    company: r.company_name,
    companyKey: normalizeKey(r.company_name),
    title: r.title,
    salaryMin: r.salary_min === null ? null : Number(r.salary_min),
    salaryMax: r.salary_max === null ? null : Number(r.salary_max),
    currency: r.currency,
    location: r.location ?? "",
    workMode: r.work_mode ?? "unknown",
    level: r.level ?? "unknown",
    years: r.years === null ? null : Number(r.years),
    english: r.english_required ?? "none",
    certSupport: Boolean(r.cert_support),
    have: r.stack.filter((s) => OWNER_STACK.has(s)),
    gap: r.stack.filter((s) => !OWNER_STACK.has(s)),
    score: r.score,
    reasons: r.score_reasons,
    excerpts: r.raw_excerpts ?? {},
    sources: (r.sources ?? []).map((s) => ({ name: sourceName(s.source), url: s.url, firstSeen: s.first_seen_at, lastSeen: s.last_seen_at })),
    firstSeen: r.first_seen_at.toISOString(),
    postedAt: r.posted_at?.toISOString() ?? null,
    repostedAt: r.reposted_at?.toISOString() ?? null,
    closedAt: r.closed_at?.toISOString() ?? null,
    status: r.status,
    note: r.note,
    statusAt: r.status_at.toISOString(),
  }));

  const { rows: registry } = await pool.query<{
    key: string | null; name: string; watch: boolean; website: string | null; website_source: string | null;
    career_status: string; career_checked_at: Date | null; career_url: string | null; career_kind: string | null;
    relevance: number; relevance_reasons: string[];
  }>(`SELECT c.key, c.name, c.watch, c.website, c.website_source, c.career_status, c.career_checked_at, c.relevance, c.relevance_reasons,
             p.url AS career_url, p.kind AS career_kind
        FROM companies c
        LEFT JOIN LATERAL (SELECT url, kind FROM career_pages WHERE company_id = c.id ORDER BY depth, id LIMIT 1) p ON true`);
  const info = new Map(registry.map((c) => [c.key ?? normalizeKey(c.name), c]));
  const view = (key: string, name: string): CompanyView => {
    const c = info.get(key);
    return {
      key, name, watch: Boolean(c?.watch), website: c?.website ?? null, websiteSource: c?.website_source ?? null,
      careerStatus: c?.career_status ?? "unknown", careerUrl: c?.career_url ?? null, careerKind: c?.career_kind ?? null,
      careerCheckedAt: c?.career_checked_at?.toISOString() ?? null,
      relevance: c?.relevance ?? 0, relevanceReasons: c?.relevance_reasons ?? [],
    };
  };
  const byKey = new Map<string, CompanyView>();
  for (const p of postings) if (!byKey.has(p.companyKey)) byKey.set(p.companyKey, view(p.companyKey, p.company));
  // Watched companies with no posting yet still belong on the watchlist.
  for (const c of registry) {
    const key = c.key ?? normalizeKey(c.name);
    if (c.watch && !byKey.has(key)) byKey.set(key, view(key, c.name));
  }

  const health = await sourceHealth();
  const m = await loadLearned();
  const learning = {
    labels: m?.labels ?? 0, liked: m?.liked ?? 0, skipped: m?.skipped ?? 0, needed: MIN_LABELS, active: active(m),
    top: m ? Object.entries(m.delta).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6).map(([k, d]) => ({ label: m.labelOf[k], points: Math.round(d) })) : [],
  };
  return { now: new Date().toISOString(), prefs, learning, postings, companies: [...byKey.values()], sources: health.sources, usage: health.usage };
}

// The parts of a posting only the detail pane needs.
export async function loadDescription(id: number): Promise<{ description: string; terms: string[] } | null> {
  const { rows } = await pool.query<{ description: string | null; stack: string[] }>("SELECT description, stack FROM jobs WHERE id = $1", [id]);
  if (!rows[0]) return null;
  const description = rows[0].description ?? "";
  return { description, terms: matchedTerms(description, rows[0].stack) };
}

// The exact words in the text that named each detected skill, so the screen can emphasise them.
function matchedTerms(text: string, stack: string[]): string[] {
  const terms = new Set<string>();
  for (const skill of stack) {
    const re = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    for (const m of text.matchAll(re)) terms.add(m[0]);
  }
  if (stack.includes("Kubernetes")) for (const m of text.matchAll(/\bk8s\b/gi)) terms.add(m[0]);
  return [...terms];
}
