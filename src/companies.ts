// The company registry that grows from the postings themselves: every company seen on a job board is
// recorded, and once its website is known its career page is looked for.
import type pg from "pg";
import { pool } from "./db.js";
import { normalizeKey } from "./normalize-key.js";
import { enqueue } from "./queue.js";

// Where a website came from, best first. A better source replaces a worse one.
const SOURCE_RANK: Record<string, number> = { owner: 4, topdev: 3, vietnamworks: 2, "contact email": 1 };

const FREE_MAIL = /(^|\.)(gmail|yahoo|outlook|hotmail|icloud|live|msn|proton|protonmail|aol|zoho)\./i;
const NOT_A_COMPANY_SITE = /(^|\.)(itviec|topcv|topdev|vietnamworks|linkedin|facebook|google|youtube|careerviet|careerlink|glints|indeed|vieclam24h)\./i;

export function siteRoot(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!u.hostname.includes(".") || NOT_A_COMPANY_SITE.test(u.hostname)) return null;
    return `https://${u.hostname.replace(/^www\./, "")}`;
  } catch {
    return null;
  }
}

// A contact e-mail's domain is the company's site only when it resembles the company name
// ("lienpta@tinhvan.com" for "Tinhvan Software JSC"); recruiters and agencies are skipped.
export function websiteFromEmails(companyName: string, text: string): string | null {
  const key = normalizeKey(companyName).replace(/\s+/g, "");
  for (const m of text.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
    const domain = m[1].toLowerCase();
    if (FREE_MAIL.test(domain)) continue;
    const label = domain.split(".").slice(0, -1).filter((p) => !["com", "vn", "co", "net", "jsc"].includes(p)).pop() ?? "";
    if (label.length >= 3 && (key.includes(label.replace(/-/g, "")) || label.replace(/-/g, "").includes(key))) return siteRoot(domain);
  }
  return null;
}

// The first link in a company profile text that is not a job board (VietnamWorks profiles often carry it).
export function websiteFromText(text: string): string | null {
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    const root = siteRoot(m[0]);
    if (root) return root;
  }
  return null;
}

type Client = pg.Pool | pg.PoolClient;

// Records the company (once) and its website when the new source is better than the stored one.
// Returns the company id. A newly learned website queues a search for the career page.
export async function ensureCompany(
  name: string,
  website: { url: string | null; source: string } | null,
  client: Client = pool,
): Promise<number> {
  const key = normalizeKey(name);
  const { rows } = await client.query<{ id: string; website: string | null; website_source: string | null }>(
    `INSERT INTO companies (name, key, discovered_via) VALUES ($1, $2, 'posting')
     ON CONFLICT (key) DO UPDATE SET name = companies.name
     RETURNING id, website, website_source`,
    [name, key],
  );
  const c = rows[0];
  const id = Number(c.id);
  const url = website?.url ? siteRoot(website.url) : null;
  if (url && website && (SOURCE_RANK[website.source] ?? 0) > (SOURCE_RANK[c.website_source ?? ""] ?? 0) && url !== c.website) {
    await client.query("UPDATE companies SET website = $2, website_source = $3, career_status = 'unknown' WHERE id = $1", [id, url, website.source]);
    await enqueue("career-discover", url, { priority: 60, payload: { companyId: id } });
  }
  return id;
}
