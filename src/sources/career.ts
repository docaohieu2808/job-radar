// Company career pages: find the page from the company's website, then read it on an adaptive schedule.
// Applicant tracking systems are read through their API; self-built pages by their job links, with the
// LLM only as a fallback when postings are listed without links.
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { pool } from "../db.js";
import { fetchSite } from "../http.js";
import { renderPage } from "../browser.js";
import { enqueue, pauseHost } from "../queue.js";
import { robotsAllow } from "../robots.js";
import { loadPrefs } from "../settings.js";
import { htmlToText, isRelevantTitle } from "../extract.js";
import { contentHash, markSeen, savePosting } from "../store.js";
import { askJson } from "../llm.js";
import { HostRefusedError } from "../handlers/index.js";
import { detectAts, listAtsJobs, type Ats } from "./ats.js";
import { noteOutboundLinks } from "./discovery.js";
import { HOUR, type Source } from "./types.js";
import type { Task } from "../queue.js";
import type { HandlerResult } from "../handlers/index.js";

const DAY = 24 * HOUR;
const MAX_INTERVAL = 7 * DAY;
// Every career page is read at least daily, quiet or not, so any company's new opening shows the same day;
// watched companies twice a day. Unchanged pages cost one request and a hash comparison.
const QUIET_PAGE_INTERVAL = DAY;
const WATCH_INTERVAL = 12 * HOUR;
// A site with no career page yet is looked at again weekly: companies add one when they start hiring.
const REDISCOVER_AFTER = 7 * DAY;
const MAX_LISTING_CHILDREN = 3;
export const CAREER_WORDS = /tuyển dụng|tuyen-dung|tuyendung|careers?\b|\bjobs?\b|join us|join-us|recruit|cơ hội nghề nghiệp|co-hoi-nghe-nghiep|việc làm|viec-lam|work with us|talent[- ]acquisition|vacanc(y|ies)|we'?re hiring/i;
// A listing page, not one posting: "/jobs", "/careers/openings", "Vị trí đang tuyển", "Cơ hội nghề nghiệp".
const LISTING_WORDS = /\/(jobs|careers?|openings?|positions?|vacancies|tuyen-dung|co-hoi-nghe-nghiep|recruitment|talent-acquisition)\/?$|vị trí đang tuyển|việc làm đang tuyển|open (positions|roles)|all jobs|xem tất cả|cơ hội nghề nghiệp/i;
export const CAREER_WORDS_FOR_TEST = CAREER_WORDS;
const PROBE_PATHS = ["/careers", "/career", "/tuyen-dung", "/vi/tuyen-dung", "/jobs", "/recruitment", "/talent-acquisition"];
// Job boards and social sites: a company's "open positions" button may point there, but those have their own sources.
const JOB_BOARD_HOST = /(^|\.)(linkedin\.com|itviec\.com|topdev\.vn|topcv\.vn|vietnamworks\.com|careerviet\.vn|facebook\.com|glints\.com|indeed\.com)$/i;

// Some companies keep their openings on a sister site ("Xem vị trí đang tuyển" on tinhvan.com goes to tso.vn).
// A listing link off the site is followed when its own text says it is the list of openings.
function offSiteListing(l: { url: string; text: string }, base: string): boolean {
  if (sameSite(l.url, base)) return false;
  try {
    if (JOB_BOARD_HOST.test(new URL(l.url).hostname)) return false;
  } catch {
    return false;
  }
  return LISTING_WORDS.test(l.text);
}
const TWO_PART_TLDS = /\.(com|net|org|edu|gov|ac|co)\.(vn|uk|jp|sg|au)$/i;

export function registrableDomain(host: string): string {
  const parts = host.replace(/^www\./, "").split(".");
  return parts.slice(TWO_PART_TLDS.test(host) ? -3 : -2).join(".");
}

export function sameSite(a: string, b: string): boolean {
  try {
    return registrableDomain(new URL(a).hostname) === registrableDomain(new URL(b).hostname);
  } catch {
    return false;
  }
}

// The readable part of a page: no scripts, menus, headers or footers.
export function mainText(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,nav,header,footer,form,iframe,[role=navigation]").remove();
  const main = $("main,article").first();
  const root = main.length && main.text().trim().length > 400 ? main : $("body");
  return htmlToText(root.html() ?? "").slice(0, 40_000);
}

// A page whose HTML is an empty shell filled by JavaScript.
export function needsBrowser(html: string, text: string): boolean {
  return text.length < 400 && /id=["'](root|app|__next)["']|__NUXT__|ng-version|data-reactroot/i.test(html);
}

// A company page as a reader sees it: plain fetch first, a headless browser only when that returns an empty
// JavaScript shell. Robots rules were already checked by the caller for the same address.
export async function readSite(url: string): Promise<string> {
  const html = await readSite(url);
  if (!needsBrowser(html, mainText(html))) return html;
  try {
    return await renderPage(url);
  } catch (err) {
    console.warn(`render ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return html;
  }
}

export type Link = { url: string; text: string };

// One page, one address: no fragment, no www, no trailing slash, "%2E" read as ".".
export function normalizeUrl(raw: string, base?: string): string {
  const u = new URL(raw, base);
  u.hash = "";
  u.hostname = u.hostname.replace(/^www\./, "");
  u.pathname = u.pathname.replace(/%2E/gi, ".");
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

export function isListing(l: Link): boolean {
  return LISTING_WORDS.test(new URL(l.url).pathname) || LISTING_WORDS.test(l.text);
}

export function links(html: string, base: string): Link[] {
  const $ = cheerio.load(html);
  const out = new Map<string, Link>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!;
    if (/^(mailto|tel|javascript):|^#/i.test(href)) return;
    try {
      const key = normalizeUrl(href, base);
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!out.has(key) || (text && !out.get(key)!.text)) out.set(key, { url: key, text });
    } catch {
      /* not a URL */
    }
  });
  return [...out.values()];
}

// Postings from global ATS boards are kept only for Vietnam, Ho Chi Minh City or remote Asia.
export function wantedCareerLocation(location: string): boolean {
  if (!location.trim()) return true;
  if (/viet ?nam|việt nam|ho chi minh|hồ chí minh|hcm|saigon|sài gòn/i.test(location)) return true;
  return /remote/i.test(location) && /apac|asia|vietnam|anywhere|worldwide/i.test(location);
}

// A job title names a role; service and product pages ("Cloud & DevOps Services", "Infrastructure Advisory") do not.
const ROLE = /\bengineers?\b|kỹ sư|ky su|specialist|chuyên viên|administrator|\badmin\b|\blead\b|manager|trưởng nhóm|trưởng phòng|architect|developer|lập trình viên|\bsre\b|devops\b.*\b(engineers?|lead)\b|intern|thực tập|nhân viên|consultant/i;

export function looksLikeJobTitle(text: string, keywords: string[]): boolean {
  return text.length >= 5 && text.length <= 140 && ROLE.test(text) && isRelevantTitle(text, keywords);
}

// Marketing sections that talk about engineers without hiring one ("/our-services/offshore-devops-engineers").
const NOT_A_JOB_PATH = /\/(our-)?(services?|solutions?|products?|industries|insights|blog|news|case-stud(y|ies)|dich-vu|giai-phap|san-pham)(\/|$)/i;

export function looksLikeJobLink(l: Link, keywords: string[]): boolean {
  return looksLikeJobTitle(l.text, keywords) && !NOT_A_JOB_PATH.test(new URL(l.url).pathname);
}

// A posting page carries at least two of the usual posting sections; a service page rarely does.
const POSTING_MARKERS = [
  /yêu cầu|requirements?|qualifications?/i, /quyền lợi|phúc lợi|benefits?|what we offer/i, /mô tả công việc|job description|responsibilities|trách nhiệm/i,
  /ứng tuyển|nộp hồ sơ|apply now|apply for this|gửi cv|send (your )?cv/i, /kinh nghiệm|experience/i, /mức lương|salary|thu nhập/i,
];

export function looksLikePosting(text: string): boolean {
  return POSTING_MARKERS.filter((m) => m.test(text)).length >= 2;
}

const CITY = /(h[oồ] ch[ií] minh|hcm|sài gòn|saigon|hà nội|ha noi|hanoi|đà nẵng|da nang|japan office|văn phòng nhật bản|tokyo|osaka)[^\n]{0,40}/i;

const urlId = (url: string) => createHash("sha1").update(url).digest("hex").slice(0, 16);

async function company(id: number): Promise<{ id: number; name: string; watch: boolean } | null> {
  const { rows } = await pool.query<{ id: string; name: string; watch: boolean }>("SELECT id, name, watch FROM companies WHERE id = $1", [id]);
  return rows[0] ? { id: Number(rows[0].id), name: rows[0].name, watch: Boolean(rows[0].watch) } : null;
}

async function setCareerStatus(companyId: number, status: string): Promise<void> {
  await pool.query("UPDATE companies SET career_status = $2, career_checked_at = now(), career_failures = 0 WHERE id = $1", [companyId, status]);
}

// The same site under the spellings that answer in practice: https, https with www, then plain http.
export function siteVariants(url: string): string[] {
  const u = new URL(url);
  const bare = u.hostname.replace(/^www\./, "");
  const out = [`https://${bare}`, `https://www.${bare}`, `http://${bare}`, `http://www.${bare}`].map((x) => `${x}${u.pathname === "/" ? "" : u.pathname}`);
  return [...new Set([url.replace(/\/$/, ""), ...out])];
}

const RETRY_AFTER_FAILURES = [24 * HOUR, 7 * 24 * HOUR];

export async function addCareerPage(companyId: number, rawUrl: string, ats: Ats | null, depth: number): Promise<void> {
  const url = normalizeUrl(rawUrl);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO career_pages (company_id, url, kind, ats_kind, status, depth) VALUES ($1, $2, $3, $4, 'found', $5)
     ON CONFLICT (url) DO UPDATE SET status = 'found' RETURNING id`,
    [companyId, url, ats ? "ats" : "custom", ats ? JSON.stringify(ats) : null, depth],
  );
  await enqueue("career-page", url, { priority: depth ? 75 : 70, payload: { careerPageId: Number(rows[0].id) } });
}

// One posting from a career page, scored with the same rules as board postings.
async function saveCareerPosting(companyName: string, p: { id: string; url: string; title: string; location: string; description: string }) {
  return savePosting({
    source: "career",
    externalId: p.id,
    url: p.url,
    companyName,
    title: p.title,
    location: p.location,
    description: p.description,
  });
}

async function readAts(companyName: string, ats: Ats): Promise<{ fetched: number; found: number }> {
  const prefs = await loadPrefs();
  const jobs = (await listAtsJobs(ats)).filter((j) => isRelevantTitle(j.title, prefs.keywords) && wantedCareerLocation(j.location));
  const ids = jobs.map((j) => `${ats.kind}:${ats.board}:${j.id}`);
  const unknown = new Set(await markSeen("career", ids));
  let fetched = 1;
  for (const [i, j] of jobs.entries()) {
    const id = ids[i];
    if (!unknown.has(id)) continue;
    let description = j.description;
    if (description === null && j.detail) {
      description = await j.detail();
      fetched++;
    }
    await saveCareerPosting(companyName, { id, url: j.url, title: j.title, location: j.location, description: description ?? j.title });
  }
  return { fetched, found: jobs.length };
}

type LlmPostings = { postings?: { title?: string; url?: string | null; location?: string | null; requirements?: string | null }[] };

// A company site that cannot be read (dead domain, broken TLS, bot protection, error page) is a fact about that
// site, not a crawler fault: it is recorded on the company or page and retried much later instead of five times now.
async function siteFailed(task: Task, err: unknown): Promise<string> {
  if (err instanceof HostRefusedError) await pauseHost(task.host, err.retryAfterSeconds);
  const cause = err instanceof Error && "cause" in err && err.cause instanceof Error ? `: ${err.cause.message}` : "";
  return `${err instanceof Error ? err.message : String(err)}${cause}`.slice(0, 300);
}

export const career: Source = {
  name: "career",
  seeds: [],
  handlers: {
    // Website home page -> career page (or an ATS board). Re-checked weekly when nothing was found.
    "career-discover": async (task) => {
      try {
        return await discover(task);
      } catch (err) {
        const message = await siteFailed(task, err);
        const { rows } = await pool.query<{ career_failures: number }>(
          "UPDATE companies SET career_status = 'error', career_checked_at = now(), career_failures = career_failures + 1 WHERE id = $1 RETURNING career_failures",
          [Number(task.payload.companyId)],
        );
        console.warn(`career-discover ${task.url}: ${message}`);
        // A first failure is often passing; retry soon, then less and less often.
        return { recrawlAfterSeconds: RETRY_AFTER_FAILURES[(rows[0]?.career_failures ?? 1) - 1] ?? REDISCOVER_AFTER };
      }
    },

    "career-page": async (task) => {
      try {
        return await readCareerPage(task);
      } catch (err) {
        const message = await siteFailed(task, err);
        await pool.query("UPDATE career_pages SET status = 'error', last_error = $2, last_fetched_at = now() WHERE id = $1", [Number(task.payload.careerPageId), message]);
        return { recrawlAfterSeconds: MAX_INTERVAL };
      }
    },

    "career-job": async (task) => {
      try {
        return await readCareerJob(task);
      } catch (err) {
        await siteFailed(task, err);
        return {};
      }
    },
  },
};

async function discover(task: Task): Promise<HandlerResult> {
  const c = await company(Number(task.payload.companyId));
  if (!c) return {};
  if (!(await robotsAllow(task.url))) {
    await setCareerStatus(c.id, "none");
    return { recrawlAfterSeconds: REDISCOVER_AFTER };
  }
  // The first spelling of the site that answers; a refusal stops here (the host is paused), other errors try the next.
  let html: string | null = null;
  let base = task.url;
  let fetched = 0;
  let lastError: unknown = null;
  for (const v of siteVariants(task.url)) {
    fetched++;
    try {
      html = await readSite(v);
      base = v;
      break;
    } catch (err) {
      if (err instanceof HostRefusedError) throw err;
      lastError = err;
    }
  }
  if (html === null) throw lastError;
  if (base !== task.url) await pool.query("UPDATE companies SET website = $2 WHERE id = $1", [c.id, new URL(base).origin]);
  const text = mainText(html);
  if (needsBrowser(html, text)) {
    await setCareerStatus(c.id, "needs_browser");
    return { fetched, recrawlAfterSeconds: REDISCOVER_AFTER };
  }
  const all = links(html, base);
  await noteOutboundLinks(c.id, base, all);
  const atsLink = all.map((l) => ({ l, ats: detectAts(l.url) })).find((x) => x.ats);
  if (atsLink) {
    await addCareerPage(c.id, atsLink.l.url, atsLink.ats, 0);
    await setCareerStatus(c.id, "found");
    return { fetched };
  }
  const candidates = all
    .filter((l) => sameSite(l.url, base) && CAREER_WORDS.test(`${l.text} ${new URL(l.url).pathname}`))
    .sort((a, b) => Number(CAREER_WORDS.test(b.text)) - Number(CAREER_WORDS.test(a.text)));
  let found = candidates[0]?.url ?? null;
  for (const path of found ? [] : PROBE_PATHS) {
    const url = new URL(path, base).toString();
    if (!(await robotsAllow(url))) continue;
    try {
      const page = await readSite(url);
      fetched++;
      if (CAREER_WORDS.test(mainText(page))) {
        found = url;
        break;
      }
    } catch (err) {
      // A refusal pauses the host; a 404 or similar just means this path is not the career page.
      if (err instanceof HostRefusedError) throw err;
    }
  }
  if (!found) {
    await setCareerStatus(c.id, "none");
    return { fetched, recrawlAfterSeconds: REDISCOVER_AFTER };
  }
  await addCareerPage(c.id, found, null, 0);
  await setCareerStatus(c.id, "found");
  return { fetched };
}

// A career page on its adaptive schedule: unchanged pages wait twice as long, up to a week.
async function readCareerPage(task: Task): Promise<HandlerResult> {
  const { rows } = await pool.query<{ id: string; company_id: string; ats_kind: string | null; content_hash: string | null; check_interval_s: number; depth: number }>(
    "SELECT id, company_id, ats_kind, content_hash, check_interval_s, depth FROM career_pages WHERE id = $1",
    [Number(task.payload.careerPageId)],
  );
  const page = rows[0];
  if (!page) return {};
  const c = await company(Number(page.company_id));
  if (!c) return {};
  const cap = c.watch ? WATCH_INTERVAL : QUIET_PAGE_INTERVAL;
  const daily = Math.min(DAY, cap);
  const done = async (status: string, interval: number, extra: { found?: number; hash?: string; changed?: boolean } = {}) => {
    await pool.query(
      `UPDATE career_pages SET status = $2, check_interval_s = $3, last_fetched_at = now(), last_error = NULL,
              postings_found = COALESCE($4, postings_found), content_hash = COALESCE($5, content_hash),
              last_changed_at = CASE WHEN $6 THEN now() ELSE last_changed_at END
        WHERE id = $1`,
      [page.id, status, interval, extra.found ?? null, extra.hash ?? null, Boolean(extra.changed)],
    );
  };

  if (page.ats_kind) {
    const r = await readAts(c.name, JSON.parse(page.ats_kind) as Ats);
    await done("found", daily, { found: r.found });
    return { fetched: r.fetched, recrawlAfterSeconds: daily };
  }

  if (!(await robotsAllow(task.url))) {
    await done("none", MAX_INTERVAL);
    return { recrawlAfterSeconds: MAX_INTERVAL };
  }
  const html = await readSite(task.url);
  const text = mainText(html);
  if (needsBrowser(html, text)) {
    await done("needs_browser", MAX_INTERVAL);
    if (!page.depth) await setCareerStatus(c.id, "needs_browser");
    return { fetched: 1, recrawlAfterSeconds: MAX_INTERVAL };
  }
  const all = links(html, task.url);
  await noteOutboundLinks(c.id, task.url, all);
  const atsLink = all.map((l) => ({ l, ats: detectAts(l.url) })).find((x) => x.ats);
  if (atsLink) {
    // The page only points to an ATS board: read the board from now on.
    await pool.query("UPDATE career_pages SET kind = 'ats', ats_kind = $2 WHERE id = $1", [page.id, JSON.stringify(atsLink.ats)]);
    const r = await readAts(c.name, atsLink.ats!);
    await done("found", daily, { found: r.found });
    return { fetched: 1 + r.fetched, recrawlAfterSeconds: daily };
  }

  const hash = contentHash(text);
  if (hash === page.content_hash) {
    const interval = Math.min(page.check_interval_s * 2, cap);
    await done("found", interval);
    return { fetched: 1, recrawlAfterSeconds: interval };
  }

  const prefs = await loadPrefs();
  const jobLinks = all.filter((l) => sameSite(l.url, task.url) && l.url !== task.url && looksLikeJobLink(l, prefs.keywords));
  const unknown = new Set(await markSeen("career", jobLinks.map((l) => urlId(l.url))));
  for (const l of jobLinks) {
    if (unknown.has(urlId(l.url))) await enqueue("career-job", l.url, { priority: 65, payload: { companyId: c.id, title: l.text } });
  }

  // Listing pages one level down (e.g. "Open positions", "Engineering") become career pages of their own.
  if (!page.depth) {
    const listings = all
      .filter((l) => l.url !== task.url && !jobLinks.includes(l) && ((sameSite(l.url, task.url) && isListing(l)) || offSiteListing(l, task.url)))
      .slice(0, MAX_LISTING_CHILDREN);
    for (const l of listings) await addCareerPage(c.id, l.url, null, 1);
  }

  let llmCalls = 0;
  if (!jobLinks.length && prefs.keywords.some((k) => text.toLowerCase().includes(k.toLowerCase()))) {
    const r = await askJson<LlmPostings>(
      "You read a company's career page. List only job postings whose title is a DevOps, SRE, platform, cloud or infrastructure role. " +
        'Reply with JSON {"postings":[{"title":string,"url":string|null,"location":string|null,"requirements":string|null}]}. ' +
        "Copy text from the page; never invent postings. requirements = the posting's own requirement text, verbatim, if shown.",
      `Page URL: ${task.url}\n\n${text}`,
    );
    if (r) llmCalls++;
    for (const p of r?.postings ?? []) {
      if (!p.title || !looksLikeJobTitle(p.title, prefs.keywords)) continue;
      const url = p.url ? normalizeUrl(p.url, task.url) : normalizeUrl(task.url);
      if (p.url && sameSite(url, task.url) && url !== task.url) {
        await enqueue("career-job", url, { priority: 65, payload: { companyId: c.id, title: p.title } });
      } else {
        await saveCareerPosting(c.name, { id: urlId(`${normalizeUrl(task.url)}#${p.title}`), url: normalizeUrl(task.url), title: p.title, location: p.location ?? "", description: p.requirements ?? p.title });
      }
    }
  }
  await done("found", daily, { found: jobLinks.length, hash, changed: true });
  return { fetched: 1, llmCalls, recrawlAfterSeconds: daily };
}

// One posting page found on a career page.
async function readCareerJob(task: Task): Promise<HandlerResult> {
  const c = await company(Number(task.payload.companyId));
  if (!c || !(await robotsAllow(task.url))) return {};
  const html = await readSite(task.url);
  const $ = cheerio.load(html);
  const text = mainText(html);
  // The page's own heading is cleaner than the link text, which may glue salary and deadline onto the title.
  const prefs = await loadPrefs();
  const h1 = $("h1").first().text().replace(/\s+/g, " ").trim();
  const title = looksLikeJobTitle(h1, prefs.keywords) ? h1 : String(task.payload.title || h1 || $("title").text().trim());
  if (!looksLikePosting(text)) {
    await pool.query(
      `INSERT INTO rejected_postings (source, external_id, reason) VALUES ('career', $1, 'not a posting')
       ON CONFLICT (source, external_id) DO UPDATE SET reason = EXCLUDED.reason, rejected_at = now()`,
      [urlId(task.url)],
    );
    return { fetched: 1 };
  }
  await saveCareerPosting(c.name, { id: urlId(task.url), url: task.url, title, location: CITY.exec(text)?.[0] ?? "", description: text });
  return { fetched: 1 };
}
