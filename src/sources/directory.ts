// TopDev's company directory for Ho Chi Minh City (about 2,400 companies, most with a website): the second
// source of the company registry, after the companies that appear in postings. Re-read weekly.
import { fetchJson } from "../http.js";
import { enqueue } from "../queue.js";
import { ensureCompany } from "../companies.js";
import { HOUR, type Source } from "./types.js";

const HCMC_REGION = "79";
const PAGE_SIZE = 100;

export const directoryUrl = (page: number) =>
  `https://api.topdev.vn/td/v2/companies?page=${page}&region_ids=${HCMC_REGION}&page_size=${PAGE_SIZE}&fields[company]=id,display_name,website`;

type Page = { data: { display_name?: string; website?: string | null }[]; meta: { current_page: number; last_page: number } };

export const directory: Source = {
  name: "directory",
  hostIntervalSeconds: { "api.topdev.vn": 20 },
  seeds: [{ kind: "directory-topdev", url: directoryUrl(1), priority: 55 }],
  handlers: {
    "directory-topdev": async (task) => {
      const body = await fetchJson<Page>(task.url);
      for (const c of body.data) {
        if (!c.display_name) continue;
        await ensureCompany(c.display_name, c.website ? { url: c.website, source: "topdev" } : null, undefined, "directory");
      }
      // Page 1 is the recurring entry point; it queues the following page, which queues the next, and so on.
      const page = body.meta.current_page;
      // One request brings 100 companies, so the directory goes ahead of the per-site work it creates.
      if (page < body.meta.last_page) await enqueue("directory-topdev", directoryUrl(page + 1), { priority: 55 });
      return { fetched: 1, recrawlAfterSeconds: page === 1 ? 7 * 24 * HOUR : undefined };
    },
  },
};
