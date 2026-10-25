// Screen 08 Overview, the Radar-like page: today's focal number, then charts drawn from the real postings.
import { css } from "./css";
import type { App } from "./app";
import { clock, dayMonth, daysAgo, salaryMillionVnd, scoreColor } from "./model";
import { companies } from "./companies";

function Head({ title, line, updated }: { title: string; line: string; updated: string }) {
  return (
    <div style={css("display:flex;justify-content:space-between;gap:16px")}>
      <div>
        <h2 style={css("margin:0;font-size:14px;font-weight:600")}>{title}</h2>
        <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>{line}</p>
      </div>
      {updated && <span style={css("font-size:12px;color:var(--ink3);white-space:nowrap")}>{updated}</span>}
    </div>
  );
}

export function OverviewScreen({ app }: { app: App }) {
  const { data, inbox, prefs, now } = app;
  const ps = data?.postings ?? [];
  const open = ps.filter((p) => !p.closedAt);
  const updated = data?.usage.lastChecked ? `Updated ${clock(data.usage.lastChecked)}` : "";
  const firstToday = ps.filter((p) => daysAgo(p.firstSeen, now) === 0).length;
  const healthy = data?.sources.filter((s) => s.status === "Healthy").length ?? 0;

  // New postings per day, last 30 days, by first seen.
  const per = Array.from({ length: 30 }, (_, k) => {
    const i = 29 - k;
    const day = new Date(now.getTime() - i * 86_400_000);
    const n = ps.filter((p) => daysAgo(p.firstSeen, now) === i).length;
    return { i, n, label: dayMonth(day.toISOString()) };
  });
  const yMax = Math.max(3, ...per.map((b) => b.n));
  const ticks = [0, Math.round(yMax / 3), Math.round((2 * yMax) / 3), yMax];

  const bySourceMap = new Map<string, number>();
  for (const p of open) for (const s of p.sources) bySourceMap.set(s.name, (bySourceMap.get(s.name) ?? 0) + 1);
  for (const s of data?.sources ?? []) if (!bySourceMap.has(s.name)) bySourceMap.set(s.name, 0);
  const bySource = [...bySourceMap.entries()].sort((a, b) => b[1] - a[1]);
  const srcMax = Math.max(1, ...bySource.map((s) => s[1]));

  const withSalary = open.map((p) => ({ p, s: salaryMillionVnd(p) })).filter((x) => x.s !== null) as { p: (typeof open)[number]; s: { lo: number; hi: number } }[];
  const salMax = Math.max(60, Math.ceil(Math.max(0, ...withSalary.map((x) => x.s.hi)) / 10) * 10);
  // About six labelled ticks whatever the range: a few yearly US salaries stretch the axis past 600M.
  const salStep = [10, 20, 50, 100, 200, 500].find((v) => salMax / v <= 6) ?? 1000;
  const salTicks = Array.from({ length: Math.floor(salMax / salStep) + 1 }, (_, i) => i * salStep);

  const skillCount = new Map<string, number>();
  for (const p of open.filter((p) => daysAgo(p.firstSeen, now) <= 31)) for (const s of [...p.have, ...p.gap]) skillCount.set(s, (skillCount.get(s) ?? 0) + 1);
  const skills = [...skillCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  const skMax = Math.max(1, ...skills.map((s) => s[1]));

  // A skill is in the stack when the server counted it as "You have" on any posting.
  const inStack = new Set(ps.flatMap((p) => p.have));
  const top = companies(app).filter((c) => c.open > 0).sort((a, b) => b.open - a.open || b.best - a.best).slice(0, 6);
  const focal = inbox.length;

  return (
    <div style={css("flex:1;min-height:0;overflow-y:auto")}>
      <div className="ov-head" style={css("padding:32px 32px 28px;display:flex;align-items:flex-end;gap:48px;border-bottom:1px solid var(--line)")}>
        <div style={css("flex:1")}>
          <div style={css("font-size:13px;font-weight:500;color:var(--ink2)")}>Matching postings in the Inbox</div>
          <div style={css("display:flex;align-items:baseline;gap:12px;margin-top:4px")}>
            <span style={css("font-size:48px;font-weight:600;letter-spacing:-0.02em;line-height:56px;color:var(--ink)")}>{focal}</span>
            <a href="#/inbox" style={css("font-size:14px;font-weight:500")}>Open Inbox</a>
          </div>
          <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>{`Match ${prefs?.inboxMin ?? 0} or higher, or from a watched company, seen in the last ${prefs?.newDays ?? 0} days.`}</p>
        </div>
        <div style={css("display:flex;gap:32px;font-size:13px;color:var(--ink2)")}>
          <div><div style={css("font-size:20px;font-weight:600;color:var(--ink)")}>{firstToday}</div>First seen today</div>
          <div><div style={css("font-size:20px;font-weight:600;color:var(--ink)")}>{(data?.usage.pagesToday ?? 0).toLocaleString("en-US")}</div>Pages checked</div>
          <div><div style={css("font-size:20px;font-weight:600;color:var(--ink)")}>{`${healthy} of ${data?.sources.length ?? 0}`}</div>Sources healthy</div>
        </div>
      </div>
      <div className="ov-grid" style={css("display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)")}>
        <section style={css("grid-column:1 / span 2;padding:24px 32px;border-bottom:1px solid var(--line)")}>
          <Head title="New postings per day" line="DevOps postings in Ho Chi Minh City by the day they were first seen, last 30 days." updated={updated} />
          <div style={css("margin-top:20px;display:grid;grid-template-columns:24px minmax(0,1fr);column-gap:8px")}>
            <div style={css("position:relative;height:160px")}>
              {ticks.map((t) => <span key={t} style={css(`position:absolute;right:0;bottom:${(t / yMax) * 100}%;transform:translateY(50%);font-size:11px;color:var(--ink3)`)}>{t}</span>)}
            </div>
            <div style={css("position:relative;height:160px")}>
              {ticks.map((t) => <span key={t} style={css(`position:absolute;left:0;right:0;bottom:${(t / yMax) * 100}%;height:1px;background:${t === 0 ? "var(--ctl)" : "var(--line)"}`)} />)}
              <div style={css("position:absolute;inset:0;display:flex;align-items:flex-end;gap:4px")}>
                {per.map((b) => (
                  <div key={b.i} title={`${b.label} · ${b.n} ${b.n === 1 ? "posting" : "postings"}`} className="hv-fade"
                    style={css(`flex:1;height:${(b.n / yMax) * 100}%;background:var(--c1);border-radius:2px 2px 0 0;transition:opacity 150ms ease-out`)} />
                ))}
              </div>
            </div>
            <span />
            <div style={css("display:flex;gap:4px;margin-top:8px")}>
              {per.map((b) => <span key={b.i} style={css("flex:1;font-size:11px;color:var(--ink3);white-space:nowrap;overflow:visible")}>{[29, 22, 15, 8, 0].includes(b.i) ? b.label : ""}</span>)}
            </div>
          </div>
        </section>
        <section style={css("padding:24px 32px;border-bottom:1px solid var(--line);border-right:1px solid var(--line)")}>
          <Head title="Postings by source" line="Open postings found on each source." updated={updated} />
          <div style={css("margin-top:16px;display:flex;flex-direction:column;gap:10px")}>
            {bySource.map(([name, n]) => (
              <div key={name} style={css("display:grid;grid-template-columns:112px minmax(0,1fr) 32px;column-gap:12px;align-items:center;font-size:13px")}>
                <span style={css("color:var(--ink2)")}>{name}</span>
                <div style={css("height:8px;border-radius:2px;background:var(--sunk)")}><div style={css(`height:8px;width:${(n / srcMax) * 100}%;background:var(--c1);border-radius:2px`)} /></div>
                <span style={css("text-align:right;font-weight:500")}>{n}</span>
              </div>
            ))}
          </div>
        </section>
        <section style={css("padding:24px 32px;border-bottom:1px solid var(--line)")}>
          <Head title="Salary distribution, DevOps in HCMC" line={`Only ${withSalary.length} of ${open.length} open postings publish a salary. ITviec and TopDev hide salary without sign-in.`} updated={updated} />
          <div style={css(`margin-top:24px;position:relative;height:${Math.max(72, 44 + withSalary.length * 10)}px`)}>
            <div style={css("position:absolute;left:0;right:0;top:28px;height:1px;background:var(--line2)")} />
            {withSalary.map(({ p, s }) => (
              <div key={p.id} title={`${p.company} · ${Math.round(s.lo)}–${Math.round(s.hi)}M VND`}
                style={css(`position:absolute;top:16px;left:${(s.lo / salMax) * 100}%;width:${Math.max(1, ((s.hi - s.lo) / salMax) * 100)}%;height:24px;border-radius:2px;background:var(--c1);opacity:${withSalary.length > 1 ? 0.55 : 1}`)} />
            ))}
            {salTicks.map((v) => (
              <div key={v} style={css(`position:absolute;top:28px;left:${(v / salMax) * 100}%;display:flex;flex-direction:column;align-items:center;transform:translateX(-50%)`)}>
                <span style={css("width:1px;height:6px;background:var(--line2)")} />
                <span style={css("margin-top:6px;font-size:11px;color:var(--ink3)")}>{v}M</span>
              </div>
            ))}
          </div>
          <div style={css("margin-top:16px;display:flex;height:8px;border-radius:2px;overflow:hidden;gap:2px")}>
            <div style={css(`width:${open.length ? (withSalary.length / open.length) * 100 : 0}%;background:var(--c1)`)} />
            <div style={css("flex:1;background:var(--c2)")} />
          </div>
          <div style={css("margin-top:8px;display:flex;gap:16px;font-size:12px;color:var(--ink2)")}>
            <span style={css("display:flex;align-items:center;gap:6px")}><span style={css("width:8px;height:8px;border-radius:2px;background:var(--c1)")} />Salary published {withSalary.length}</span>
            <span style={css("display:flex;align-items:center;gap:6px")}><span style={css("width:8px;height:8px;border-radius:2px;background:var(--c2)")} />Salary not shown {open.length - withSalary.length}</span>
          </div>
        </section>
        <section style={css("padding:24px 32px;border-right:1px solid var(--line)")}>
          <Head title="Most requested skills this month" line="Open postings naming each skill, compared with the current stack." updated={updated} />
          <div style={css("margin-top:12px;display:flex;gap:16px;font-size:12px;color:var(--ink2)")}>
            <span style={css("display:flex;align-items:center;gap:6px")}><span style={css("width:8px;height:8px;border-radius:2px;background:var(--c1)")} />In stack</span>
            <span style={css("display:flex;align-items:center;gap:6px")}><span style={css("width:8px;height:8px;border-radius:2px;background:var(--c3)")} />Gap</span>
          </div>
          <div style={css("margin-top:12px;display:flex;flex-direction:column;gap:8px")}>
            {skills.map(([name, n]) => (
              <div key={name} style={css("display:grid;grid-template-columns:112px minmax(0,1fr) 24px;column-gap:12px;align-items:center;font-size:13px")}>
                <span style={css("color:var(--ink2)")}>{name}</span>
                <div style={css("height:8px")}><div style={css(`height:8px;width:${(n / skMax) * 100}%;background:${inStack.has(name) ? "var(--c1)" : "var(--c3)"};border-radius:2px`)} /></div>
                <span style={css("text-align:right;font-weight:500")}>{n}</span>
              </div>
            ))}
          </div>
        </section>
        <section style={css("padding:24px 32px")}>
          <Head title="Companies hiring most" line="Open DevOps postings per company." updated={updated} />
          <div style={css("margin-top:12px")}>
            {top.map((c) => (
              <a key={c.key} href={`#/companies/${encodeURIComponent(c.key)}`} className="hv-row" style={css("display:grid;grid-template-columns:minmax(0,1fr) 64px 56px;column-gap:12px;align-items:center;height:36px;border-bottom:1px solid var(--line);font-size:13px;color:var(--ink);text-decoration:none")}>
                <span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{c.name}</span>
                <span style={css("text-align:right;color:var(--ink2)")}>{c.open} open</span>
                <span style={css(`text-align:right;font-weight:600;color:${scoreColor(c.best, prefs!)}`)}>{c.best}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
