// App state and behaviour, ported from the export's Component class: hash routes, triage with undo,
// keyboard shortcuts, command palette, filters, pipeline drag and drop. Screens only render what this holds.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type PostingView, type StateView } from "./api";
import { inInbox, freshIso, isOpen } from "./model";
import type { Prefs } from "../../src/prefs";

export type Route =
  | { name: "inbox" | "postings" | "pipeline" | "companies" | "overview" | "sources" }
  | { name: "posting"; id: number }
  | { name: "company"; key: string }
  | { name: "settings"; tab: string };

export const SETTINGS_TABS: [string, string][] = [["scoring", "Scoring"], ["search", "Search"], ["watchlist", "Watchlist"], ["display", "Display"]];

export function parseRoute(hash: string): Route {
  const s = hash.replace(/^#\/?/, "").split("/");
  const n = s[0] || "inbox";
  if (n === "jobs" && s[1]) return { name: "posting", id: Number(s[1]) };
  if (n === "companies" && s[1]) return { name: "company", key: decodeURIComponent(s[1]) };
  if (n === "settings") return { name: "settings", tab: SETTINGS_TABS.some((t) => t[0] === s[1]) ? s[1] : "scoring" };
  const names = ["inbox", "postings", "pipeline", "companies", "overview", "sources"] as const;
  return { name: (names as readonly string[]).includes(n) ? (n as (typeof names)[number]) : "inbox" };
}

export type Filters = Record<"match" | "salary" | "stack" | "mode" | "district" | "source" | "status" | "open", string>;
export const F0: Filters = { match: "Any", salary: "Any", stack: "Any", mode: "Any", district: "Any", source: "Any", status: "Any", open: "Any" };

type Toast = { text: string; undo?: () => void };

const SEEN_KEY = "jr-seen";
function loadSeen(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as number[]);
  } catch {
    return new Set();
  }
}
function storeSeen(seen: Set<number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-2000)));
  } catch {
    /* private window: unread dots just reset */
  }
}
function initialTheme(): "light" | "dark" {
  try {
    const t = localStorage.getItem("jr-theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    /* fall through */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useApp() {
  const [data, setData] = useState<StateView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [prev, setPrev] = useState<Route | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [seen, setSeen] = useState<Set<number>>(loadSeen);
  const [sort, setSort] = useState<"match" | "newest" | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pal, setPal] = useState(false);
  const [dlg, setDlg] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(F0);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{ k: keyof Filters; x: number; y: number } | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [vw, setVw] = useState(window.innerWidth);
  const toastTimer = useRef<number>(0);
  const routeRef = useRef(route);
  routeRef.current = route;
  const searchRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setData(await api.state());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("jr-theme", theme);
    } catch {
      /* not remembered */
    }
  }, [theme]);

  useEffect(() => {
    const onHash = () => {
      setPrev(routeRef.current);
      setRoute(parseRoute(location.hash));
      setPal(false);
      setMenu(null);
    };
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const now = useMemo(() => new Date(data?.now ?? Date.now()), [data]);
  const prefs = data?.prefs;
  const watched = useMemo(() => new Set((data?.companies ?? []).filter((c) => c.watch).map((c) => c.key)), [data]);
  const activeSort = sort ?? prefs?.defaultSort ?? "match";

  const inbox = useMemo(() => {
    if (!data || !prefs) return [];
    const list = data.postings.filter((p) => inInbox(p, prefs, watched, now));
    return activeSort === "match"
      ? list.sort((a, b) => b.score - a.score)
      : list.sort((a, b) => freshIso(b).localeCompare(freshIso(a)) || b.score - a.score);
  }, [data, prefs, watched, now, activeSort]);

  const byId = useMemo(() => new Map((data?.postings ?? []).map((p) => [p.id, p])), [data]);

  const current: PostingView | null = useMemo(() => {
    if (route.name === "posting") return byId.get(route.id) ?? null;
    return inbox.find((p) => p.id === sel) ?? inbox[0] ?? null;
  }, [route, byId, inbox, sel]);

  const go = (h: string) => {
    if (location.hash !== h) location.hash = h;
  };

  const markSeen = (id: number) =>
    setSeen((s) => {
      if (s.has(id)) return s;
      const next = new Set(s).add(id);
      storeSeen(next);
      return next;
    });

  const showToast = (t: Toast) => {
    window.clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  };

  // Local change first, then the API; a failed save reloads the truth from the server.
  const patchPosting = (id: number, patch: Partial<PostingView>) =>
    setData((d) => (d ? { ...d, postings: d.postings.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : d));

  const saveStatus = (p: PostingView, status: string, note?: string | null) => {
    patchPosting(p.id, { status, statusAt: new Date().toISOString(), ...(note !== undefined ? { note } : {}) });
    api.setStatus(p.id, status, note).catch(() => {
      showToast({ text: "Could not save. Reloaded." });
      void reload();
    });
  };

  const act = (status: "interested" | "skipped" | "applied", id?: number, note?: string | null) => {
    const p = id !== undefined ? byId.get(id) : current;
    if (!p) return;
    const before = { status: p.status, note: p.note };
    const label = { interested: "Marked Interested", skipped: "Skipped", applied: "Marked Applied" }[status];
    const commit = () => {
      // The next posting in the Inbox takes the cleared one's place.
      const i = inbox.findIndex((x) => x.id === p.id);
      const rest = inbox.filter((x) => x.id !== p.id);
      const next = rest[Math.min(Math.max(i, 0), rest.length - 1)];
      saveStatus(p, status, note);
      setLeaving(null);
      if (route.name !== "posting") {
        setSel(next ? next.id : null);
        if (next) markSeen(next.id);
      }
    };
    showToast({
      text: label,
      undo: () => {
        saveStatus(p, before.status, before.note);
        setSel(p.id);
        setToast(null);
      },
    });
    if (route.name === "inbox") {
      setLeaving(p.id);
      setHover(null);
      window.setTimeout(commit, 180);
    } else commit();
  };

  const moveTo = (p: PostingView, status: string) => {
    if (p.status === status) return;
    const before = { status: p.status, note: p.note };
    saveStatus(p, status);
    showToast({ text: `Moved to ${status[0].toUpperCase()}${status.slice(1)}`, undo: () => { saveStatus(p, before.status, before.note); setToast(null); } });
  };

  const move = (d: number) => {
    if (!inbox.length) return;
    const i = Math.max(0, inbox.findIndex((p) => p.id === (current?.id ?? -1)));
    const n = inbox[Math.min(inbox.length - 1, Math.max(0, i + d))];
    setSel(n.id);
    markSeen(n.id);
  };

  const openSource = (p = current) => {
    if (p?.sources[0]) window.open(p.sources[0].url, "_blank", "noopener");
  };

  const openApplied = (id?: number) => {
    const p = id !== undefined ? byId.get(id) : current;
    if (p) setDlg(p.id);
  };

  const openSearch = () => {
    go("#/postings");
    window.setTimeout(() => searchRef.current?.focus(), 60);
  };

  const setWatch = (name: string, key: string, watch: boolean) => {
    setData((d) => {
      if (!d) return d;
      const has = d.companies.some((c) => c.key === key);
      const companies = has ? d.companies.map((c) => (c.key === key ? { ...c, watch } : c)) : [...d.companies, { key, name, watch, website: null, websiteSource: null, careerStatus: "unknown", careerUrl: null, careerKind: null, careerCheckedAt: null, relevance: 0, relevanceReasons: [] }];
      return { ...d, companies };
    });
    api.watch(name, watch).catch(() => {
      showToast({ text: "Could not save. Reloaded." });
      void reload();
    });
  };

  const setWebsite = async (name: string, website: string) => {
    try {
      await api.website(name, website);
      showToast({ text: "Website saved. Looking for the career page." });
      void reload();
    } catch {
      showToast({ text: "That is not a website address." });
    }
  };

  const savePrefs = async (next: Prefs, text?: string) => {
    setData((d) => (d ? { ...d, prefs: next } : d));
    try {
      await api.savePrefs(next);
      if (text) showToast({ text });
      // Weights rescore every posting on the server; fetch the new scores.
      void reload();
    } catch {
      showToast({ text: "Could not save. Reloaded." });
      void reload();
    }
  };

  // Keyboard map from the export: ⌘K, /, Esc, and j k i s a o on the Inbox and posting pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPal((v) => !v);
        setMenu(null);
        return;
      }
      if (e.key === "Escape") {
        setPal(false);
        setDlg(null);
        setMenu(null);
        return;
      }
      if (typing || pal || dlg !== null || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        openSearch();
        return;
      }
      const r = route.name;
      if (r !== "inbox" && r !== "posting") return;
      const map: Record<string, () => void> = {
        j: () => r === "inbox" && move(1),
        k: () => r === "inbox" && move(-1),
        i: () => act("interested"),
        s: () => act("skipped"),
        a: () => openApplied(),
        o: () => openSource(),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return {
    data, loadError, reload, route, prev, now, prefs, watched, inbox, byId, current,
    sel, setSel, hover, setHover, leaving, seen, markSeen, sort: activeSort, setSort,
    toast, setToast, showToast, pal, setPal, dlg, setDlg, filters, setFilters, q, setQ, menu, setMenu,
    theme, setTheme, vw, compact: vw < 1180, phone: vw < 700, searchRef,
    go, act, moveTo, move, openSource, openApplied, openSearch, setWatch, setWebsite, savePrefs, isOpen,
  };
}

export type App = ReturnType<typeof useApp>;
