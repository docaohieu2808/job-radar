// LinkedIn guest pages (no sign-in). One request every 5 minutes: at 90 s the guest API started answering 429 after about 8 requests.
import * as cheerio from "cheerio";
import { fetchText } from "../http.js";
import { enqueue } from "../queue.js";
import { pool } from "../db.js";
import { markSeen, savePosting, type Posting } from "../store.js";
import { htmlToText } from "../extract.js";
import { HOUR, type Source } from "./types.js";

const HOST = "www.linkedin.com";
// LinkedIn answers bursts with 429 even at low volume; back off for a few hours rather than a day.
const PAUSE_WHEN_REFUSED = 3 * HOUR;
const DAILY_POSTING_BUDGET = 100;

function searchUrl(keywords: string, location: string, extra = ""): string {
  const q = new URLSearchParams({ keywords, location, f_TPR: "r604800", start: "0" });
  return `https://${HOST}/jobs-guest/jobs/api/seeMoreJobPostings/search?${q}${extra}`;
}

export type SearchCard = { id: string; title: string; company: string; location: string; postedAt: string | null };

export function parseSearch(html: string): SearchCard[] {
  const $ = cheerio.load(html);
  return $("[data-entity-urn^='urn:li:jobPosting:']")
    .map((_, el) => {
      const card = $(el);
      return {
        id: card.attr("data-entity-urn")!.split(":").pop()!,
        title: card.find(".base-search-card__title").text().trim(),
        company: card.find(".base-search-card__subtitle").text().trim(),
        location: card.find(".job-search-card__location").text().trim(),
        postedAt: card.find("time").attr("datetime") ?? null,
      };
    })
    .get();
}

export function parsePosting(html: string, id: string): Posting {
  const $ = cheerio.load(html);
  const criteria = $(".description__job-criteria-item")
    .map((_, el) => `${$(el).find("h3").text().trim()}: ${$(el).find("span").text().trim()}`)
    .get();
  const description = htmlToText($(".show-more-less-html__markup").html() ?? "");
  return {
    source: "linkedin",
    externalId: id,
    url: `https://www.linkedin.com/jobs/view/${id}`,
    title: $(".top-card-layout__title").first().text().trim(),
    companyName: $(".topcard__org-name-link").first().text().trim(),
    location: $(".topcard__flavor--bullet").first().text().trim(),
    salaryText: $(".compensation__salary").first().text().trim() || undefined,
    description: [description, ...criteria].join("\n"),
    closed: /No longer accepting applications/i.test(html),
  };
}

async function postingsQueuedToday(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM crawl_queue WHERE kind = 'linkedin-posting' AND created_at > date_trunc('day', now())",
  );
  return Number(rows[0].n);
}

export const linkedin: Source = {
  name: "linkedin",
  hostIntervalSeconds: { [HOST]: 300 },
  seeds: [
    { kind: "linkedin-search", url: searchUrl("devops", "Ho Chi Minh City, Vietnam"), priority: 10 },
    { kind: "linkedin-search", url: searchUrl("devops", "Ho Chi Minh City, Vietnam").replace("start=0", "start=10"), priority: 20 },
    { kind: "linkedin-search", url: searchUrl("site reliability engineer", "Ho Chi Minh City, Vietnam"), priority: 20 },
    { kind: "linkedin-search", url: searchUrl("platform engineer", "Ho Chi Minh City, Vietnam"), priority: 30 },
    { kind: "linkedin-search", url: searchUrl("cloud engineer", "Ho Chi Minh City, Vietnam"), priority: 30 },
    { kind: "linkedin-search", url: searchUrl("devsecops", "Ho Chi Minh City, Vietnam"), priority: 40 },
    { kind: "linkedin-search", url: searchUrl("devops", "Vietnam", "&f_WT=2"), priority: 20 },
  ],
  handlers: {
    "linkedin-search": async (task) => {
      const cards = parseSearch(await fetchText(task.url, { browserLike: true, refusedPauseSeconds: PAUSE_WHEN_REFUSED }));
      const unknown = new Set(await markSeen("linkedin", cards.map((c) => c.id)));
      let budget = DAILY_POSTING_BUDGET - (await postingsQueuedToday());
      for (const card of cards) {
        if (!unknown.has(card.id) || budget <= 0) continue;
        await enqueue("linkedin-posting", `https://${HOST}/jobs-guest/jobs/api/jobPosting/${card.id}`, {
          priority: 50,
          payload: { id: card.id, postedAt: card.postedAt },
        });
        budget--;
      }
      return { recrawlAfterSeconds: 12 * HOUR, fetched: 1 };
    },
    "linkedin-posting": async (task) => {
      const id = String(task.payload.id);
      const posting = parsePosting(await fetchText(task.url, { browserLike: true, refusedPauseSeconds: PAUSE_WHEN_REFUSED }), id);
      const postedAt = task.payload.postedAt ? new Date(String(task.payload.postedAt)) : null;
      await savePosting({ ...posting, postedAt });
      return { fetched: 1 };
    },
  },
};
