// Link discovery, the URL extractor and URL filter of a classic crawler aimed at one topic: sites that known company
// pages link to (sister companies, parents, partners, clients) become candidates; each is read once and kept only
// if it looks like an IT company in Vietnam or one hiring remotely. Kept ones join the registry and their career
// pages are then found and read like any other company's.
import * as cheerio from "cheerio";
import { pool } from "../db.js";
import { enqueue } from "../queue.js";
import { robotsAllow } from "../robots.js";
import { askJson } from "../llm.js";
import { ensureCompany } from "../companies.js";
import { HostRefusedError } from "../handlers/index.js";
import { CAREER_WORDS, links, mainText, readSite, registrableDomain, type Link } from "./career.js";
import type { Source } from "./types.js";

// Spider-trap guard: candidates found on a discovered company's site may be followed once more, no further.
export const MAX_HOPS = 2;
const PER_PAGE = 10;
const ACCEPT_AT = 60;
const REJECT_AT = 25;

// Platforms, social networks, job boards, news, government and shared services: never a company to track.
const NOT_A_CANDIDATE =
  /^(facebook|fb|twitter|x|linkedin|instagram|youtube|youtu|tiktok|zalo|pinterest|reddit|discord|telegram|t|wa|whatsapp|messenger|google|goo|gstatic|googleapis|googletagmanager|doubleclick|apple|microsoft|live|office|bing|amazon|amazonaws|cloudflare|cloudfront|jsdelivr|unpkg|wordpress|wp|gravatar|github|gitlab|bitbucket|medium|blogspot|bit|tinyurl|shopee|lazada|tiki|sendo|itviec|topcv|topdev|vietnamworks|careerviet|careerlink|glints|indeed|vieclam24h|vnexpress|tuoitre|thanhnien|cafef|cafebiz|dantri|zingnews|genk|w3|schema|creativecommons|mozilla|adobe|hubspot|mailchimp|typeform|calendly|zoom|slack|notion|figma|canva|wix|squarespace|shopify|myshopify|dmca|trustpilot|apps|play|itunes|onelink|firebaseapp|vercel|netlify|herokuapp|hotjar|clarity|intercom|zendesk|freshdesk|tawk|crisp|recaptcha|cookielaw|onetrust|cookiebot)\./i;
const PUBLIC_SECTOR = /\.(gov|edu|ac|org)\.vn$|\.gov$|\.edu$|\.mil$/i;

export function candidateDomain(url: string, pageUrl: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
    if (!/^https?:$/.test(new URL(url).protocol)) return null;
  } catch {
    return null;
  }
  const domain = registrableDomain(host);
  if (!domain.includes(".") || domain === registrableDomain(new URL(pageUrl).hostname)) return null;
  if (NOT_A_CANDIDATE.test(`${domain}`) || PUBLIC_SECTOR.test(domain)) return null;
  return domain;
}

// Called by the career handlers with the links of a company home page or career page.
export async function noteOutboundLinks(companyId: number, pageUrl: string, pageLinks: Link[]): Promise<number> {
  const { rows } = await pool.query<{ discovery_hops: number }>("SELECT discovery_hops FROM companies WHERE id = $1", [companyId]);
  const hops = (rows[0]?.discovery_hops ?? 0) + 1;
  if (hops > MAX_HOPS) return 0;
  const domains = [...new Set(pageLinks.map((l) => candidateDomain(l.url, pageUrl)).filter((d): d is string => Boolean(d)))].slice(0, PER_PAGE);
  let added = 0;
  for (const domain of domains) if (await addCandidate(domain, pageUrl, companyId, hops)) added++;
  return added;
}

// A new candidate site, unless it is already a company or was seen before. Also used for the Common Crawl import.
export async function addCandidate(domain: string, foundOn: string, fromCompany: number | null, hops: number, priority = 92): Promise<boolean> {
  if (NOT_A_CANDIDATE.test(domain) || PUBLIC_SECTOR.test(domain)) return false;
  const known = await pool.query("SELECT 1 FROM companies WHERE website = $1 OR website = $2 LIMIT 1", [`https://${domain}`, `https://www.${domain}`]);
  if (known.rowCount) return false;
  const r = await pool.query(
    "INSERT INTO domain_candidates (domain, found_on, from_company, hops) VALUES ($1, $2, $3, $4) ON CONFLICT (domain) DO NOTHING",
    [domain, foundOn, fromCompany, hops],
  );
  if (!r.rowCount) return false;
  await enqueue("candidate-check", `https://${domain}`, { priority, payload: { domain } });
  return true;
}

const IT_WORDS = [
  /phần mềm|software/i, /công nghệ thông tin|information technology|\bIT (services|company|solutions|outsourcing)\b/i, /outsourc|gia công/i,
  /\bsaas\b|platform|nền tảng/i, /cloud|điện toán đám mây|devops|kubernetes/i, /chuyển đổi số|digital transformation/i,
  /fintech|blockchain|\bAI\b|machine learning|trí tuệ nhân tạo|data (platform|engineering)/i, /developers?|engineers?|kỹ sư|lập trình/i,
  /web (and|&) mobile|mobile app|ứng dụng di động|app development/i, /giải pháp công nghệ|technology (company|solutions|partner)/i,
];
const HCMC = /h[oồ] ch[ií] minh|tp\.? ?hcm|\bhcmc\b|sài gòn|saigon/i;
const VIETNAM = /việt nam|vietnam|viet nam|hà nội|hanoi|đà nẵng|da nang/i;
const REMOTE = /remote[- ]first|fully remote|work from anywhere|distributed team|remote team/i;
const COMPANY = /công ty (tnhh|cổ phần|cp)|\bjsc\b|co\.,? ?ltd|\binc\b|\bllc\b|\bgmbh\b|pte\.? ltd|mã số thuế|\bmst\b|copyright|©/i;
const SHOP = /giỏ hàng|thêm vào giỏ|add to cart|mua ngay|thanh toán khi nhận hàng|free shipping/i;
const PARKED = /domain (is )?for sale|buy this domain|parked|tên miền (này )?đang được bán/i;

export type CandidateScore = { score: number; reasons: string[]; name: string; careerLink: boolean };

// Rule score 0–100 from the home page; the reasons are kept for the Sources screen and for checking by hand.
export function scoreCandidate(html: string, domain: string): CandidateScore {
  const text = mainText(html);
  const $ = cheerio.load(html);
  const meta = [$("title").first().text(), $("meta[name=description]").attr("content"), $("meta[property='og:description']").attr("content")];
  const all = `${text}\n${meta.filter(Boolean).join(" ")}`;
  const reasons: string[] = [];
  let score = 0;
  const it = IT_WORDS.filter((r) => r.test(all)).length;
  if (it) {
    score += Math.min(40, it * 8);
    reasons.push(`${it} IT signals`);
  }
  if (HCMC.test(all)) {
    score += 20;
    reasons.push("Ho Chi Minh City");
  } else if (VIETNAM.test(all) || /\.vn$/.test(domain)) {
    score += 10;
    reasons.push("Vietnam");
  }
  if (REMOTE.test(all)) {
    score += 10;
    reasons.push("remote team");
  }
  if (COMPANY.test(all)) {
    score += 10;
    reasons.push("company details");
  }
  const careerLink = links(html, `https://${domain}`).some((l) => CAREER_WORDS.test(`${l.text} ${l.url}`));
  if (careerLink) {
    score += 20;
    reasons.push("careers link");
  }
  if (SHOP.test(all)) {
    score -= 20;
    reasons.push("online shop");
  }
  if (PARKED.test(all) || text.length < 200) {
    score -= 50;
    reasons.push(text.length < 200 ? "almost empty page" : "parked domain");
  }
  return { score: Math.max(0, Math.min(100, score)), reasons, name: siteName(html, domain), careerLink };
}

export function siteName(html: string, domain: string): string {
  const $ = cheerio.load(html);
  const og = $("meta[property='og:site_name']").attr("content")?.trim();
  if (og && og.length <= 60) return og;
  const title = $("title").first().text().split(/\s[|\-–—:·]\s/)[0]?.trim();
  if (title && title.length >= 2 && title.length <= 60 && !/^(home|trang chủ|welcome)$/i.test(title)) return title;
  return domain.split(".")[0].replace(/^\w/, (c) => c.toUpperCase());
}

type LlmVerdict = { it_company: boolean; vietnam_or_remote: boolean; name: string };

async function checkCandidate(domain: string): Promise<void> {
  const url = `https://${domain}`;
  const decide = (status: string, score: number | null, by: string | null, reason: string, companyId: number | null = null) =>
    pool.query(
      "UPDATE domain_candidates SET status = $2, score = $3, decided_by = $4, reason = $5, company_id = $6, checked_at = now() WHERE domain = $1",
      [domain, status, score, by, reason, companyId],
    );
  if (!(await robotsAllow(url))) return void (await decide("rejected", null, "rules", "robots.txt disallows the home page"));
  let html: string;
  try {
    html = await readSite(url);
  } catch (err) {
    if (err instanceof HostRefusedError) throw err;
    return void (await decide("error", null, null, err instanceof Error ? err.message.slice(0, 200) : String(err)));
  }
  const s = scoreCandidate(html, domain);
  let accept = s.score >= ACCEPT_AT;
  let by = "rules";
  let name = s.name;
  if (s.score > REJECT_AT && s.score < ACCEPT_AT) {
    const v = await askJson<LlmVerdict>(
      "You classify a website from its home page text. Answer JSON " +
        '{"it_company":boolean,"vietnam_or_remote":boolean,"name":string}: it_company = a company whose business is software, IT ' +
        "services or a tech product (not a shop, school, news site or agency directory); vietnam_or_remote = it has an office in " +
        "Vietnam or hires remote engineers; name = the company's name.",
      `Domain: ${domain}\n\n${mainText(html).slice(0, 4000)}`,
    );
    if (v) {
      accept = v.it_company && v.vietnam_or_remote;
      by = "llm";
      if (v.name?.trim()) name = v.name.trim().slice(0, 80);
    } else {
      // No LLM budget left today: decide on the rules alone, leaning towards keeping.
      accept = s.score >= (ACCEPT_AT + REJECT_AT) / 2;
    }
  }
  if (!accept) return void (await decide("rejected", s.score, by, s.reasons.join(", ") || "no IT or location signals"));
  const { rows } = await pool.query<{ hops: number }>("SELECT hops FROM domain_candidates WHERE domain = $1", [domain]);
  const companyId = await ensureCompany(name, { url, source: "discovered link" }, pool, "link");
  await pool.query("UPDATE companies SET discovery_hops = GREATEST(discovery_hops, $2) WHERE id = $1 AND discovered_via = 'link'", [companyId, rows[0]?.hops ?? 1]);
  await decide("accepted", s.score, by, s.reasons.join(", "), companyId);
}

export const discovery: Source = {
  name: "discovery",
  seeds: [],
  handlers: {
    "candidate-check": async (task) => {
      await checkCandidate(String(task.payload.domain));
      return { fetched: 1 };
    },
  },
};
