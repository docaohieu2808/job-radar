// Screens 06 Companies and 07 Company page. Career-page status is left out until career pages are crawled.
import { useState } from "react";
import { css } from "./css";
import { Icon } from "./icons";
import type { App } from "./app";
import type { PostingView } from "./api";
import { ageText, dayMonth, district, postedIso, salaryText, scoreColor, sourceText, tile, initial } from "./model";
import { Switch } from "./pipeline";

export type CompanyAgg = { key: string; name: string; district: string; open: number; last: string; best: number; watched: boolean; postings: PostingView[] };

export function companies(app: App): CompanyAgg[] {
  const groups = new Map<string, PostingView[]>();
  for (const p of app.data?.postings ?? []) groups.set(p.companyKey, [...(groups.get(p.companyKey) ?? []), p]);
  const out: CompanyAgg[] = [];
  for (const [key, ps] of groups) {
    const districts = ps.map((p) => district(p.location));
    out.push({
      key,
      name: ps[0].company,
      district: districts.sort((a, b) => districts.filter((d) => d === b).length - districts.filter((d) => d === a).length)[0],
      open: ps.filter((p) => !p.closedAt).length,
      last: ps.map(postedIso).sort().at(-1)!,
      best: Math.max(...ps.map((p) => p.score)),
      watched: app.watched.has(key),
      postings: ps,
    });
  }
  return out;
}

const GRID = "display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1.2fr) 120px 120px 40px;column-gap:16px;padding:0 24px";

export function CompaniesScreen({ app }: { app: App }) {
  const [watchOnly, setWatchOnly] = useState(false);
  const rows = companies(app).filter((c) => c.open > 0 && (!watchOnly || c.watched)).sort((a, b) => b.last.localeCompare(a.last));
  return (
    <div style={css("flex:1;min-height:0;display:flex;flex-direction:column")}>
      <div style={css("padding:20px 24px 16px;display:flex;align-items:flex-end;justify-content:space-between;border-bottom:1px solid var(--line)")}>
        <div>
          <h1 style={css("margin:0;font-size:24px;font-weight:600;letter-spacing:-0.01em")}>Companies</h1>
          <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>{`${rows.length} companies with open postings${watchOnly ? " on the watchlist" : ""}`}</p>
        </div>
        <label style={css("display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2)")}>
          <Switch on={watchOnly} onClick={() => setWatchOnly((v) => !v)} />
          Watchlist only
        </label>
      </div>
      <div className="co-grid" style={css(`${GRID};height:32px;align-items:center;border-bottom:1px solid var(--line);font-size:12px;color:var(--ink3);font-weight:500`)}>
        <span>Company</span><span>District</span><span style={css("text-align:right")}>Open postings</span><span>Last posting</span><span />
      </div>
      <div style={css("flex:1;overflow-y:auto")}>
        {rows.map((c) => {
          const t = tile(c.key);
          return (
            <div key={c.key} className="hv-row co-grid" style={css(`${GRID};height:48px;align-items:center;border-bottom:1px solid var(--line);transition:background 150ms ease-out`)}>
              <a href={`#/companies/${encodeURIComponent(c.key)}`} style={css("display:flex;align-items:center;gap:12px;min-width:0;color:var(--ink);font-size:14px;font-weight:500")}>
                <span style={{ ...css("width:28px;height:28px;flex:none;border-radius:6px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center"), background: t.tileBg, color: t.tileInk }}>{initial(c.name)}</span>
                <span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{c.name}</span>
              </a>
              <span style={css("font-size:13px;color:var(--ink2)")}>{c.district}</span>
              <span style={css("font-size:13px;text-align:right")}>{c.open}</span>
              <span style={css("font-size:13px;color:var(--ink2)")}>{dayMonth(c.last)}</span>
              <button onClick={() => app.setWatch(c.name, c.key, !c.watched)} aria-pressed={c.watched} title="Watchlist" className="hv-nav"
                style={css(`width:32px;height:32px;border:0;border-radius:10px;background:transparent;color:${c.watched ? "var(--acc-ink)" : "var(--ink3)"};display:flex;align-items:center;justify-content:center;cursor:pointer`)}>
                <Icon id={c.watched ? "starf" : "star"} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CompanyScreen({ app, companyKey }: { app: App; companyKey: string }) {
  const c = companies(app).find((x) => x.key === companyKey);
  if (!c) return <p style={css("margin:40px 32px;font-size:14px;color:var(--ink2)")}>No postings from this company yet.</p>;
  const t = tile(c.key);
  const open = c.postings.filter((p) => !p.closedAt).sort((a, b) => b.score - a.score);
  const all = [...c.postings].sort((a, b) => postedIso(a).localeCompare(postedIso(b)));
  // Timeline from the month of the first posting to the end of this month.
  const first = new Date(postedIso(all[0]));
  const start = new Date(first.getFullYear(), first.getMonth(), 1);
  const end = new Date(app.now.getFullYear(), app.now.getMonth() + 1, 1);
  const span = end.getTime() - start.getTime();
  const x = (iso: string) => `${(((new Date(iso).getTime() - start.getTime()) / span) * 100).toFixed(2)}%`;
  const months: { l: string; x: string }[] = [];
  for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const mid = new Date(d.getFullYear(), d.getMonth(), 15);
    months.push({ l: mid.toLocaleString("en-GB", { month: "short" }), x: `${(((mid.getTime() - start.getTime()) / span) * 100).toFixed(2)}%` });
  }
  const range = `${months[0]?.l} to ${months.at(-1)?.l} ${app.now.getFullYear()}`;
  return (
    <div style={css("flex:1;min-height:0;overflow-y:auto")}>
      <div style={css("max-width:880px;margin:0 auto;padding:40px 32px 48px;display:flex;flex-direction:column;gap:32px")}>
        <div style={css("position:relative;background:var(--raised);border-radius:16px;box-shadow:var(--sh2);padding:36px 24px 20px;display:flex;align-items:flex-end;gap:16px")}>
          <div style={{ ...css("position:absolute;left:24px;top:-24px;width:48px;height:48px;border-radius:10px;font-size:20px;font-weight:600;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 4px var(--sheet), var(--sh1)"), background: t.tileBg, color: t.tileInk }}>{initial(c.name)}</div>
          <div style={css("flex:1;min-width:0")}>
            <h1 style={css("margin:0;font-size:24px;font-weight:600;letter-spacing:-0.01em")}>{c.name}</h1>
            <div style={css("margin-top:6px;display:flex;gap:16px;font-size:13px;color:var(--ink2)")}><span>{c.district}</span></div>
          </div>
          <label style={css("display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2)")}>
            <Switch on={c.watched} onClick={() => app.setWatch(c.name, c.key, !c.watched)} label="Watchlist" />
            Watchlist
          </label>
        </div>
        <section>
          <h2 style={css("margin:0;font-size:14px;font-weight:600")}>Open postings</h2>
          <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>{open.length ? "Postings still live on at least one source." : "No open postings right now."}</p>
          <div style={css("margin-top:8px")}>
            {open.map((p) => {
              const salary = salaryText(p);
              return (
                <a key={p.id} href={`#/jobs/${p.id}`} className="hv-row" style={css("display:grid;grid-template-columns:40px minmax(0,1fr) 180px 72px;column-gap:16px;align-items:center;height:48px;border-bottom:1px solid var(--line);color:var(--ink);text-decoration:none")}>
                  <span style={css(`font-size:16px;font-weight:600;color:${scoreColor(p.score, app.prefs!)}`)}>{p.score}</span>
                  <span style={css("font-size:14px;font-weight:500")}>{p.title}</span>
                  <span style={css(`font-size:13px;color:${salary ? "var(--ink)" : "var(--ink3)"}`)}>{salary ?? "Salary not shown"}</span>
                  <span style={css("font-size:13px;color:var(--ink3)")}>{ageText(postedIso(p), app.now)}</span>
                </a>
              );
            })}
          </div>
        </section>
        <section>
          <h2 style={css("margin:0;font-size:14px;font-weight:600")}>Postings over time</h2>
          <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>Every posting seen from this company, {range}, with salary where published.</p>
          <div style={css("position:relative;margin-top:24px;height:56px")}>
            <div style={css("position:absolute;left:0;right:0;top:12px;height:1px;background:var(--line2)")} />
            {months.map((m) => (
              <div key={m.l + m.x} style={css(`position:absolute;top:8px;left:${m.x};display:flex;flex-direction:column;align-items:center;transform:translateX(-50%)`)}>
                <span style={css("width:1px;height:9px;background:var(--line2)")} />
                <span style={css("margin-top:8px;font-size:12px;color:var(--ink3)")}>{m.l}</span>
              </div>
            ))}
            {all.map((p) => (
              <span key={p.id} title={p.title} style={css(`position:absolute;top:7px;left:${x(postedIso(p))};width:11px;height:11px;margin-left:-5px;border-radius:9999px;background:var(--c1);box-shadow:0 0 0 3px var(--sheet)`)} />
            ))}
          </div>
          <div style={css("margin-top:8px")}>
            {all.map((p) => {
              const salary = salaryText(p);
              return (
                <div key={p.id} style={css("display:grid;grid-template-columns:72px minmax(0,1fr) 120px auto;column-gap:16px;padding:10px 0;border-bottom:1px solid var(--line);font-size:13px")}>
                  <span style={css("color:var(--ink3)")}>{dayMonth(postedIso(p))}</span>
                  <a href={`#/jobs/${p.id}`} style={css("color:var(--ink)")}>{p.title}</a>
                  <span style={css("color:var(--ink2)")}>{sourceText(p)}</span>
                  <span style={css(`font-weight:500;color:${salary ? "var(--ink)" : "var(--ink3)"}`)}>{salary ?? "Salary not shown"}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
