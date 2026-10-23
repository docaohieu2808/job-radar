// Company career pages: find the page from the company's website, then read it on an adaptive schedule.
// Applicant tracking systems are read through their API; self-built pages by their job links, with the
// LLM only as a fallback when postings are listed without links.
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { pool } from "../db.js";
import { fetchText } from "../http.js";
import { enqueue } from "../queue.js";
import { robotsAllow } from "../robots.js";
import { loadPrefs } from "../settings.js";
import { htmlToText, isRelevantTitle } from "../extract.js";
import { contentHash, markSeen, savePosting } from "../store.js";
import { askJson } from "../llm.js";
import { HostRefusedError } from "../handlers/index.js";
import { detectAts, listAtsJobs, type Ats } from "./ats.js";
import { HOUR, type Source } from "./types.js";

const DAY = 24 * HOUR;
const MAX_INTERVAL = 7 * DAY;
const REDISCOVER_AFTER = 30 * DAY;
const MAX_LISTING_CHILDREN = 3;
const CAREER_WORDS = /tuyển dụng|tuyen-dung|tuyendung|careers?\b|\bjobs?\b|join us|join-us|recruit|cơ hội nghề nghiệp|co-hoi-nghe-nghiep|việc làm|viec-lam|work with us/i;
// A listing page, not one posting: "/jobs", "/careers/openings", "Vị trí đang tuyển", "Cơ hội nghề nghiệp".
const LISTING_WORDS = /\/(jobs|careers?|openings?|positions?|vacancies|tuyen-dung|co-hoi-nghe-nghiep|recruitment)\/?$|vị trí đang tuyển|việc làm đang tuyển|open (positions|roles)|all jobs|xem tất cả|cơ hội nghề nghiệp/i;
const PROBE_PATHS = ["/careers", "/career", "/tuyen-dung", "/vi/tuyen-dung", "/jobs", "/recruitment"];
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

export type Link = { url: string; text: string };

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
      const u = new URL(href, base);
      u.hash = "";
      const text = $(el).text().replace(/\s+/g, " ").trim();
      const key = u.toString();
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

const CITY = /(h[oồ] ch[ií] minh|hcm|sài gòn|saigon|hà nội|ha noi|hanoi|đà nẵng|da nang)[^\n]{0,40}/i;

const urlId = (url: string) => createHash("sha1").update(url).digest("hex").slice(0, 16);

async function company(id: number): Promise<{ id: number; name: string } | null> {
  const { rows } = await pool.query<{ id: string; name: string }>("SELECT id, name FROM companies WHERE id = $1", [id]);
  return rows[0] ? { id: Number(rows[0].id), name: rows[0].name } : null;
}

async function setCareerStatus(companyId: number, status: string): Promise<void> {
  await pool.query("UPDATE companies SET career_status = $2, career_checked_at = now() WHERE id = $1", [companyId, status]);
}

async function addCareerPage(companyId: number, url: string, ats: Ats | null, depth: number): Promise<void> {
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

export const career: Source = {
  name: "career",
  seeds: [],
  handlers: {
    // Website home page -> career page (or an ATS board). Re-checked monthly when nothing was found.
    "career-discover": async (task) => {
      const c = await company(Number(task.payload.companyId));
      if (!c) return {};
      if (!(await robotsAllow(task.url))) {
        await setCareerStatus(c.id, "none");
        return { recrawlAfterSeconds: REDISCOVER_AFTER };
      }
      const html = await fetchText(task.url, { browserLike: true });
      let fetched = 1;
      const text = mainText(html);
      if (needsBrowser(html, text)) {
        await setCareerStatus(c.id, "needs_browser");
        return { fetched, recrawlAfterSeconds: REDISCOVER_AFTER };
      }
      const all = links(html, task.url);
      const atsLink = all.map((l) => ({ l, ats: detectAts(l.url) })).find((x) => x.ats);
      if (atsLink) {
        await addCareerPage(c.id, atsLink.l.url, atsLink.ats, 0);
        await setCareerStatus(c.id, "found");
        return { fetched };
      }
      const candidates = all
        .filter((l) => sameSite(l.url, task.url) && CAREER_WORDS.test(`${l.text} ${new URL(l.url).pathname}`))
        .sort((a, b) => Number(CAREER_WORDS.test(b.text)) - Number(CAREER_WORDS.test(a.text)));
      let found = candidates[0]?.url ?? null;
      for (const path of found ? [] : PROBE_PATHS) {
        const url = new URL(path, task.url).toString();
        if (!(await robotsAllow(url))) continue;
        try {
          const page = await fetchText(url, { browserLike: true });
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
    },

    // A career page on its adaptive schedule: unchanged pages wait twice as long, up to a week.
    "career-page": async (task) => {
      const { rows } = await pool.query<{ id: string; company_id: string; ats_kind: string | null; content_hash: string | null; check_interval_s: number; depth: number }>(
        "SELECT id, company_id, ats_kind, content_hash, check_interval_s, depth FROM career_pages WHERE id = $1",
        [Number(task.payload.careerPageId)],
      );
      const page = rows[0];
      if (!page) return {};
      const c = await company(Number(page.company_id));
      if (!c) return {};
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
        await done("found", DAY, { found: r.found });
        return { fetched: r.fetched, recrawlAfterSeconds: DAY };
      }

      if (!(await robotsAllow(task.url))) {
        await done("none", MAX_INTERVAL);
        return { recrawlAfterSeconds: MAX_INTERVAL };
      }
      const html = await fetchText(task.url, { browserLike: true });
      const text = mainText(html);
      if (needsBrowser(html, text)) {
        await done("needs_browser", MAX_INTERVAL);
        if (!page.depth) await setCareerStatus(c.id, "needs_browser");
        return { fetched: 1, recrawlAfterSeconds: MAX_INTERVAL };
      }
      const all = links(html, task.url);
      const atsLink = all.map((l) => ({ l, ats: detectAts(l.url) })).find((x) => x.ats);
      if (atsLink) {
        // The page only points to an ATS board: read the board from now on.
        await pool.query("UPDATE career_pages SET kind = 'ats', ats_kind = $2 WHERE id = $1", [page.id, JSON.stringify(atsLink.ats)]);
        const r = await readAts(c.name, atsLink.ats!);
        await done("found", DAY, { found: r.found });
        return { fetched: 1 + r.fetched, recrawlAfterSeconds: DAY };
      }

      const hash = contentHash(text);
      if (hash === page.content_hash) {
        const interval = Math.min(page.check_interval_s * 2, MAX_INTERVAL);
        await done("found", interval);
        return { fetched: 1, recrawlAfterSeconds: interval };
      }

      const prefs = await loadPrefs();
      const jobLinks = all.filter((l) => sameSite(l.url, task.url) && l.url !== task.url && l.text.length >= 5 && l.text.length <= 140 && isRelevantTitle(l.text, prefs.keywords));
      const unknown = new Set(await markSeen("career", jobLinks.map((l) => urlId(l.url))));
      for (const l of jobLinks) {
        if (unknown.has(urlId(l.url))) await enqueue("career-job", l.url, { priority: 65, payload: { companyId: c.id, title: l.text } });
      }

      // Listing pages one level down (e.g. "Open positions", "Engineering") become career pages of their own.
      if (!page.depth) {
        const listings = all
          .filter((l) => sameSite(l.url, task.url) && l.url !== task.url && !jobLinks.includes(l) && isListing(l))
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
          if (!p.title || !isRelevantTitle(p.title, prefs.keywords)) continue;
          const url = p.url ? new URL(p.url, task.url).toString() : task.url;
          if (p.url && sameSite(url, task.url) && url !== task.url) {
            await enqueue("career-job", url, { priority: 65, payload: { companyId: c.id, title: p.title } });
          } else {
            await saveCareerPosting(c.name, { id: urlId(`${task.url}#${p.title}`), url: task.url, title: p.title, location: p.location ?? "", description: p.requirements ?? p.title });
          }
        }
      }
      await done("found", DAY, { found: jobLinks.length, hash, changed: true });
      return { fetched: 1, llmCalls, recrawlAfterSeconds: DAY };
    },

    // One posting page found on a career page.
    "career-job": async (task) => {
      const c = await company(Number(task.payload.companyId));
      if (!c || !(await robotsAllow(task.url))) return {};
      const html = await fetchText(task.url, { browserLike: true });
      const $ = cheerio.load(html);
      const text = mainText(html);
      const title = String(task.payload.title || $("h1").first().text().trim() || $("title").text().trim());
      await saveCareerPosting(c.name, { id: urlId(task.url), url: task.url, title, location: CITY.exec(text)?.[0] ?? "", description: text });
      return { fetched: 1 };
    },
  },
};
