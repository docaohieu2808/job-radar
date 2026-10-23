// Screen 04 All postings: every posting ever seen, searchable and filterable, with saved filters.
import { css } from "./css";
import { Icon } from "./icons";
import { kbd } from "./shell";
import { F0, type App, type Filters } from "./app";
import type { PostingView } from "./api";
import { MODE_LABEL, STATUS_COLOR, ageText, chips, district, place, postedIso, salaryText, scoreColor, sourceText, statusLabel, tile, initial } from "./model";

const GRID = "display:grid;grid-template-columns:48px minmax(0,2.4fr) minmax(0,1.6fr) 170px 150px 110px 64px 112px;column-gap:16px;padding:0 24px";

export function filterDefs(app: App): { k: keyof Filters; l: string; o: string[] }[] {
  const ps = app.data?.postings ?? [];
  const count = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  };
  return [
    { k: "match", l: "Match", o: ["Any", "80 or higher", "70 or higher", "Below 70"] },
    { k: "salary", l: "Salary", o: ["Any", "Shown", "Not shown"] },
    { k: "stack", l: "Stack", o: ["Any", ...count(ps.flatMap((p) => [...p.have, ...p.gap])).slice(0, 10)] },
    { k: "mode", l: "Work mode", o: ["Any", "At office", "Hybrid", "Remote"] },
    { k: "district", l: "District", o: ["Any", ...count(ps.map((p) => district(p.location))).slice(0, 8)] },
    { k: "source", l: "Source", o: ["Any", ...count(ps.flatMap((p) => p.sources.map((s) => s.name)))] },
    { k: "status", l: "Status", o: ["Any", "New", "Interested", "Applied", "Interviewing", "Offer", "Skipped"] },
    { k: "open", l: "Open or closed", o: ["Any", "Open", "Closed"] },
  ];
}

const SAVED: { n: string; f: Partial<Filters> }[] = [
  { n: "Top matches", f: { match: "80 or higher", open: "Open" } },
  { n: "Hybrid", f: { mode: "Hybrid" } },
  { n: "Kubernetes, open", f: { stack: "Kubernetes", open: "Open" } },
  { n: "Salary shown, open", f: { salary: "Shown", open: "Open" } },
];

export function passes(p: PostingView, f: Filters, q: string): boolean {
  if (q && !`${p.title} ${p.company}`.toLowerCase().includes(q.toLowerCase())) return false;
  if ((f.match === "80 or higher" && p.score < 80) || (f.match === "70 or higher" && p.score < 70) || (f.match === "Below 70" && p.score >= 70)) return false;
  const shown = salaryText(p) !== null;
  if ((f.salary === "Shown" && !shown) || (f.salary === "Not shown" && shown)) return false;
  if (f.stack !== "Any" && ![...p.have, ...p.gap].includes(f.stack)) return false;
  if (f.mode !== "Any" && MODE_LABEL[p.workMode] !== f.mode) return false;
  if (f.district !== "Any" && district(p.location) !== f.district) return false;
  if (f.source !== "Any" && !p.sources.some((s) => s.name === f.source)) return false;
  if (f.status !== "Any" && statusLabel(p) !== f.status) return false;
  if ((f.open === "Open" && p.closedAt) || (f.open === "Closed" && !p.closedAt)) return false;
  return true;
}

export function PostingsScreen({ app }: { app: App }) {
  const { data, filters: f, q, prefs, now } = app;
  const all = data?.postings ?? [];
  const list = all.filter((p) => passes(p, f, q)).sort((a, b) => b.score - a.score);
  const anyFilter = (Object.keys(F0) as (keyof Filters)[]).some((k) => f[k] !== F0[k]) || Boolean(q);
  const defs = filterDefs(app);
  return (
    <div style={css("flex:1;min-height:0;display:flex;flex-direction:column")}>
      <div style={css("padding:20px 24px 0;display:flex;align-items:flex-end;justify-content:space-between")}>
        <div>
          <h1 style={css("margin:0;font-size:24px;font-weight:600;letter-spacing:-0.01em")}>All postings</h1>
          <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>{`${all.length} postings seen · ${all.filter((p) => !p.closedAt).length} open · ${list.length} shown`}</p>
        </div>
      </div>
      <div style={css("padding:16px 0 0 24px;display:flex;gap:8px;align-items:center")}>
        <div style={css("position:relative;flex:none")}>
          <Icon id="search" style={css("position:absolute;left:10px;top:8px;color:var(--ink3)")} />
          <input ref={app.searchRef} value={q} onChange={(e) => app.setQ(e.target.value)} placeholder="Search title or company" className="hv-ctl fc-acc"
            style={css("width:260px;height:32px;box-sizing:border-box;padding:0 32px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);font-size:13px;color:var(--ink);transition:border-color 150ms ease-out")} />
          <kbd style={{ ...kbd, ...css("position:absolute;right:7px;top:7px") }}>/</kbd>
        </div>
        <div className="no-scrollbar" style={css("flex:1;min-width:0;display:flex;gap:8px;overflow-x:auto")}>
          {defs.map((d) => {
            const v = f[d.k];
            const on = v !== "Any";
            return (
              <button key={d.k} className="hv-ctl press" onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); app.setMenu({ k: d.k, x: b.left, y: b.bottom + 4 }); }}
                style={css(`height:32px;flex:none;padding:0 8px 0 12px;border-radius:10px;border:1px solid ${on ? "var(--ctl)" : "var(--line2)"};background:${on ? "var(--hover)" : "var(--sheet)"};color:${on ? "var(--ink)" : "var(--ink2)"};font-size:13px;font-weight:500;display:flex;align-items:center;gap:4px;cursor:pointer;transition:border-color 150ms ease-out`)}>
                {on ? `${d.l}: ${v}` : d.l}<Icon id="down" style={css("color:var(--ink3)")} />
              </button>
            );
          })}
        </div>
      </div>
      <div style={css("padding:12px 24px;display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--line)")}>
        <span style={css("font-size:12px;color:var(--ink3);margin-right:4px")}>Saved</span>
        {SAVED.map((s) => {
          const on = (Object.keys(F0) as (keyof Filters)[]).every((k) => (s.f[k] ?? "Any") === f[k]);
          return (
            <button key={s.n} aria-pressed={on} className="hv-ctl press" onClick={() => app.setFilters(on ? { ...F0 } : { ...F0, ...s.f })}
              style={css(`height:28px;padding:0 10px;border-radius:6px;border:1px solid ${on ? "var(--ink)" : "var(--line2)"};background:${on ? "var(--hover)" : "var(--sheet)"};color:${on ? "var(--ink)" : "var(--ink2)"};font-size:13px;font-weight:500;cursor:pointer;transition:border-color 150ms ease-out`)}>
              {s.n}
            </button>
          );
        })}
        {anyFilter && (
          <button onClick={() => { app.setFilters({ ...F0 }); app.setQ(""); }} style={css("height:28px;padding:0 8px;border:0;background:transparent;color:var(--acc-ink);font-size:13px;font-weight:500;cursor:pointer")}>Clear filters</button>
        )}
      </div>
      <div style={css(`${GRID};height:32px;align-items:center;border-bottom:1px solid var(--line);font-size:12px;color:var(--ink3);font-weight:500`)}>
        <span>Match</span><span>Posting</span><span>Reasons</span><span>Salary</span><span>Place</span><span>Source</span><span>Seen</span><span>Status</span>
      </div>
      <div style={css("flex:1;min-height:0;overflow-y:auto")}>
        {list.map((p) => {
          const t = tile(p.companyKey);
          const salary = salaryText(p);
          const st = statusLabel(p);
          return (
            <a key={p.id} href={`#/jobs/${p.id}`} className="hv-row" style={css(`${GRID};height:56px;align-items:center;border-bottom:1px solid var(--line);color:var(--ink);text-decoration:none;transition:background 150ms ease-out`)}>
              <span style={css(`font-size:16px;font-weight:600;color:${scoreColor(p.score, prefs!)}`)}>{p.score}</span>
              <span style={css("display:flex;align-items:center;gap:12px;min-width:0")}>
                <span style={{ ...css("width:28px;height:28px;flex:none;border-radius:6px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center"), background: t.tileBg, color: t.tileInk }}>{initial(p.company)}</span>
                <span style={css("min-width:0;display:flex;flex-direction:column")}>
                  <span style={css("font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.title}</span>
                  <span style={css("font-size:12px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.company}</span>
                </span>
              </span>
              <span style={css("display:flex;flex-wrap:wrap;column-gap:6px;row-gap:8px;height:20px;overflow:hidden;white-space:nowrap")}>
                {chips(p).map((c, i) => (
                  <span key={i} style={css("height:20px;padding:0 6px;flex:none;border-radius:6px;background:var(--sunk);font-size:12px;color:var(--ink2);display:inline-flex;align-items:center;gap:4px")}>
                    <span style={css(`color:${c.col};font-weight:600`)}>{c.sign}</span>{c.t}
                  </span>
                ))}
              </span>
              <span style={css(`font-size:13px;color:${salary ? "var(--ink)" : "var(--ink3)"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{salary ?? "Salary not shown"}</span>
              <span style={css("font-size:13px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{place(p)}</span>
              <span style={css("font-size:13px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{sourceText(p)}</span>
              <span style={css("font-size:13px;color:var(--ink3)")}>{ageText(postedIso(p), now)}</span>
              <span style={css("display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink2)")}>
                <span style={css(`width:6px;height:6px;border-radius:9999px;background:${p.closedAt ? "var(--ink3)" : STATUS_COLOR[st]}`)} />
                {st + (p.closedAt ? " · Closed" : "")}
              </span>
            </a>
          );
        })}
        {list.length === 0 && (
          <div style={css("padding:64px 24px;display:flex;flex-direction:column;align-items:center;gap:12px")}>
            <p style={css("margin:0;font-size:14px;color:var(--ink2)")}>No postings match these filters.</p>
            <button onClick={() => { app.setFilters({ ...F0 }); app.setQ(""); }} className="hv-ctl" style={css("height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);font-size:13px;font-weight:500;cursor:pointer")}>Clear filters</button>
          </div>
        )}
      </div>
    </div>
  );
}
