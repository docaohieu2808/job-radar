// ITviec: DevOps listings in HCMC, then each new posting page. Salary is hidden without sign-in, so it stays empty.
import * as cheerio from "cheerio";
import { fetchText } from "../http.js";
import { enqueue } from "../queue.js";
import { markSeen, savePosting, type Posting } from "../store.js";
import { htmlToText } from "../extract.js";
import { HOUR, type Source } from "./types.js";

const BASE = "https://itviec.com";

export function parseSearch(html: string): { slug: string; id: string }[] {
  const $ = cheerio.load(html);
  const slugs = new Set<string>();
  $("[data-search--job-selection-job-slug-value]").each((_, el) => {
    slugs.add($(el).attr("data-search--job-selection-job-slug-value")!);
  });
  if (slugs.size === 0) {
    $("a[href^='/it-jobs/']").each((_, el) => {
      const m = /^\/it-jobs\/([a-z0-9-]+-\d{3,6})(?:\?|$)/.exec($(el).attr("href")!);
      if (m) slugs.add(m[1]);
    });
  }
  return [...slugs].map((slug) => ({ slug, id: slug.split("-").pop()! }));
}

export function parsePosting(html: string, slug: string): Posting {
  const $ = cheerio.load(html);
  const header = $(".job-show-header").first();
  const info = $(".job-show-info").first();
  // Address, work mode and "Posted ..." are the plain text lines of the info block, in that order.
  const lines = info
    .find("span.normal-text")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean);
  const skills = info
    .find("a.itag")
    .map((_, el) => $(el).text().trim())
    .get();
  const description = htmlToText($(".job-content").first().html() ?? "");
  return {
    source: "itviec",
    externalId: slug.split("-").pop()!,
    url: `${BASE}/it-jobs/${slug}`,
    title: header.find("h1").first().text().trim(),
    companyName: header.find(".employer-name").first().text().trim(),
    location: lines.find((l) => !/^(posted|hybrid|at office|remote)/i.test(l)) ?? "",
    tags: skills,
    description: [lines.join("\n"), description].join("\n"),
  };
}

export const itviec: Source = {
  name: "itviec",
  hostIntervalSeconds: { "itviec.com": 20 },
  seeds: [
    { kind: "itviec-search", url: `${BASE}/it-jobs/devops/ho-chi-minh-hcm`, priority: 10 },
    { kind: "itviec-search", url: `${BASE}/it-jobs/devops/ho-chi-minh-hcm?page=2`, priority: 30 },
  ],
  handlers: {
    "itviec-search": async (task) => {
      const found = parseSearch(await fetchText(task.url, { browserLike: true }));
      const unknown = new Set(await markSeen("itviec", found.map((f) => f.id)));
      for (const f of found) {
        if (unknown.has(f.id)) await enqueue("itviec-posting", `${BASE}/it-jobs/${f.slug}`, { priority: 50, payload: { slug: f.slug } });
      }
      return { recrawlAfterSeconds: 12 * HOUR, fetched: 1 };
    },
    "itviec-posting": async (task) => {
      await savePosting(parsePosting(await fetchText(task.url, { browserLike: true }), String(task.payload.slug)));
      return { fetched: 1 };
    },
  },
};
