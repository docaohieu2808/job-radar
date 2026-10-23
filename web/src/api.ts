// Calls to the Job Radar API (same origin).
import type { StateView } from "../../src/api/view-types";
import type { Prefs } from "../../src/prefs";

export type { StateView };
export type { PostingView, CompanyView, SourceHealth, Usage } from "../../src/api/view-types";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  state: () => call<StateView>("GET", "/api/state"),
  description: (id: number) => call<{ description: string; terms: string[] }>("GET", `/api/jobs/${id}/description`),
  setStatus: (id: number, status: string, note?: string | null) => call("POST", `/api/jobs/${id}/status`, { status, note }),
  watch: (name: string, watch: boolean) => call("POST", "/api/companies/watch", { name, watch }),
  savePrefs: (prefs: Prefs) => call<Prefs>("PUT", "/api/prefs", prefs),
  checkSource: (id: string) => call<{ ok: boolean; pausedUntil: string | null; message: string }>("POST", `/api/sources/${id}/check`),
};
