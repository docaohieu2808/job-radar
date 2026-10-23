// Outbound HTTP for every source: one User-Agent, a timeout, and refusals turned into HostRefusedError.
import { config } from "./config.js";
import { Agent, fetch as undiciFetch } from "undici";
import { HostRefusedError } from "./handlers/index.js";

export type FetchOptions = { method?: string; headers?: Record<string, string>; body?: string; browserLike?: boolean };

// Some sources only answer a browser User-Agent; the contact address stays in the From header.
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";

// Certificate problems that say nothing about the page itself (missing intermediate, expired, self-signed).
const TLS_ONLY = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_UNTRUSTED",
]);
// Used only to read public company career pages again after such an error; nothing is ever sent through it.
const lenientTls = new Agent({ connect: { rejectUnauthorized: false } });

function errorCode(err: unknown): string {
  const cause = err instanceof Error ? (err.cause as { code?: string } | undefined) : undefined;
  return cause?.code ?? "";
}

export function isTlsOnly(err: unknown): boolean {
  return TLS_ONLY.has(errorCode(err));
}

// fetchText for a company site: a certificate-only failure is retried without certificate checks.
export async function fetchSite(url: string, opts: FetchOptions = {}): Promise<string> {
  try {
    return await fetchText(url, opts);
  } catch (err) {
    if (!isTlsOnly(err)) throw err;
    return fetchText(url, { ...opts, lenientTls: true });
  }
}

export async function fetchText(url: string, opts: FetchOptions & { lenientTls?: boolean } = {}): Promise<string> {
  // The lenient agent belongs to the undici package, so it goes with that package's fetch.
  const doFetch = (opts.lenientTls
    ? (u: string, init: RequestInit) => undiciFetch(u, { ...(init as object), dispatcher: lenientTls } as Parameters<typeof undiciFetch>[1])
    : fetch) as (u: string, init: RequestInit) => Promise<Response>;
  const res = await doFetch(url, {
    method: opts.method ?? "GET",
    body: opts.body,
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "user-agent": opts.browserLike ? BROWSER_UA : config.userAgent,
      from: "contact@docaohieu.com",
      "accept-language": "en-US,en;q=0.9,vi;q=0.8",
      ...opts.headers,
    },
  });
  if (res.status === 429 || res.status === 403 || res.status === 999) {
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new HostRefusedError(res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
  }
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  return JSON.parse(await fetchText(url, { ...opts, headers: { accept: "application/json", ...opts.headers } })) as T;
}
