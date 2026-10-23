// Phone 390 layouts from "Job Radar Phone.dc.html": bottom tab bar, list then drill-in, actions pinned at the bottom.
import { useState, type ReactNode } from "react";
import { css } from "./css";
import { Icon } from "./icons";
import type { App } from "./app";
import type { PostingView } from "./api";
import { ageText, chips, place, postedIso, salaryText, scoreColor, sourceText, stage, tile, initial } from "./model";
import { inboxSubtitle, SortSwitch } from "./inbox";
import { benefits, facts, segments, useDescription } from "./posting-detail";
import { PipelineCard, Switch } from "./pipeline";
import { SettingsBody } from "./settings";
import { passes } from "./postings";

const TABS: [string, string, string, string[]][] = [
  ["Inbox", "#/inbox", "inbox", ["inbox"]],
  ["Postings", "#/postings", "list", ["postings", "companies", "company"]],
  ["Pipeline", "#/pipeline", "pipe", ["pipeline"]],
  ["Overview", "#/overview", "chart", ["overview", "sources"]],
  ["Settings", "#/settings", "set", ["settings"]],
];

function TabBar({ app }: { app: App }) {
  const r = app.route.name === "posting" ? (app.prev?.name ?? "inbox") : app.route.name;
  return (
    <nav style={css("height:64px;flex:none;display:flex;padding:0 8px 8px;background:var(--canvas)")}>
      {TABS.map(([l, href, icon, names]) => {
        const on = names.includes(r);
        return (
          <a key={l} href={href} style={css(`flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:11px;font-weight:500;color:${on ? "var(--ink)" : "var(--ink3)"};text-decoration:none`)}>
            <span style={css("position:relative;display:flex")}>
              <Icon id={icon} size={18} style={css(`color:${on ? "var(--accent)" : "var(--ink3)"}`)} />
              {l === "Inbox" && app.inbox.length > 0 && (
                <span style={css("position:absolute;left:12px;top:-6px;min-width:18px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:9999px;background:var(--sheet);box-shadow:inset 0 0 0 1px var(--line);font-size:11px;font-weight:600;color:var(--ink);display:flex;align-items:center;justify-content:center")}>{app.inbox.length}</span>
              )}
            </span>
            {l}
          </a>
        );
      })}
    </nav>
  );
}

function Title({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div style={css("padding:16px 16px 12px;display:flex;align-items:center;justify-content:space-between")}>
      <div>
        <div style={css("font-size:24px;font-weight:600;letter-spacing:-0.01em")}>{title}</div>
        {sub && <div style={css("margin-top:2px;font-size:13px;color:var(--ink3)")}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function PhoneRow({ app, p }: { app: App; p: PostingView }) {
  const t = tile(p.companyKey);
  const salary = salaryText(p);
  return (
    <a href={`#/jobs/${p.id}`} onClick={() => app.markSeen(p.id)} style={css("position:relative;height:84px;box-sizing:border-box;padding:10px 14px 10px 16px;display:grid;grid-template-columns:32px minmax(0,1fr) 32px;column-gap:12px;border-bottom:1px solid var(--line);color:var(--ink);text-decoration:none")}>
      <div style={{ ...css("width:32px;height:32px;border-radius:6px;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;margin-top:2px"), background: t.tileBg, color: t.tileInk }}>{initial(p.company)}</div>
      <div style={css("min-width:0")}>
        <div style={css("height:20px;display:flex;align-items:center;gap:6px")}>
          {!app.seen.has(p.id) && <span style={css("width:6px;height:6px;flex:none;border-radius:9999px;background:var(--accent)")} />}
          <span style={css("font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.title}</span>
        </div>
        <div style={css("height:18px;font-size:12px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{`${p.company} · ${place(p)} · ${sourceText(p)}`}</div>
        <div style={css("height:20px;margin-top:6px;display:flex;gap:6px;white-space:nowrap;overflow:hidden")}>
          <span style={css(`font-size:13px;color:${salary ? "var(--ink)" : "var(--ink3)"};flex:none`)}>{salary ?? "Salary not shown"}</span>
          {chips(p, 2).map((c, i) => (
            <span key={i} style={css("height:20px;padding:0 6px;flex:none;border-radius:6px;background:var(--sunk);font-size:12px;color:var(--ink2);display:inline-flex;align-items:center;gap:4px")}>
              <span style={css(`color:${c.col};font-weight:600`)}>{c.sign}</span>{c.t}
            </span>
          ))}
        </div>
      </div>
      <div style={css("display:flex;flex-direction:column;align-items:flex-end")}>
        <span style={css(`font-size:16px;font-weight:600;color:${scoreColor(p.score, app.prefs!)}`)}>{p.score}</span>
        <span style={css("font-size:11px;color:var(--ink3);white-space:nowrap")}>{ageText(postedIso(p), app.now)}</span>
      </div>
    </a>
  );
}

function Sheet({ children, rounded = "16px 16px 0 0", pad = "0" }: { children: ReactNode; rounded?: string; pad?: string }) {
  return <div style={css(`flex:1;min-height:0;margin:0 16px;background:var(--sheet);border-radius:${rounded};box-shadow:var(--sh1);overflow-y:auto;padding:${pad}`)}>{children}</div>;
}

function PhoneInbox({ app }: { app: App }) {
  return (
    <>
      <Title title="Inbox" sub={inboxSubtitle(app)} right={
        <button onClick={() => app.setPal(true)} aria-label="Search" style={css("width:44px;height:44px;border:0;border-radius:10px;background:transparent;display:flex;align-items:center;justify-content:center;color:var(--ink2);cursor:pointer")}><Icon id="search" size={18} /></button>
      } />
      <div style={css("padding:0 16px 12px;display:flex")}><SortSwitch app={app} phone /></div>
      <Sheet>
        {app.inbox.map((p) => <PhoneRow key={p.id} app={app} p={p} />)}
        {app.data && app.inbox.length === 0 && (
          <div style={css("padding:48px 16px;display:flex;flex-direction:column;align-items:center;gap:12px")}>
            <p style={css("margin:0;font-size:14px;color:var(--ink2)")}>Nothing new in the last {app.prefs!.newDays} days.</p>
            <a href="#/postings" style={css("font-size:14px;font-weight:500")}>See all postings</a>
          </div>
        )}
      </Sheet>
    </>
  );
}

function PhonePostings({ app }: { app: App }) {
  const list = (app.data?.postings ?? []).filter((p) => passes(p, app.filters, app.q)).sort((a, b) => b.score - a.score);
  return (
    <>
      <Title title="All postings" sub={`${list.length} shown`} />
      <div style={css("padding:0 16px 12px")}>
        <input value={app.q} onChange={(e) => app.setQ(e.target.value)} placeholder="Search title or company" className="fc-acc"
          style={css("width:100%;height:44px;box-sizing:border-box;padding:0 14px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);font-size:16px")} />
      </div>
      <Sheet>{list.map((p) => <PhoneRow key={p.id} app={app} p={p} />)}</Sheet>
    </>
  );
}

function PhonePosting({ app, p }: { app: App; p: PostingView }) {
  const desc = useDescription(p.id);
  const t = tile(p.companyKey);
  const back = app.prev && app.prev.name !== "posting" ? app.prev : { name: "inbox" as const };
  const backHref = back.name === "company" ? `#/companies/${encodeURIComponent(back.key)}` : back.name === "settings" ? "#/settings" : `#/${back.name}`;
  const backLabel = { inbox: "Inbox", postings: "Postings", pipeline: "Pipeline", companies: "Companies", company: "Company", overview: "Overview", sources: "Sources", settings: "Settings" }[back.name];
  const first = p.sources[0];
  return (
    <div style={css("flex:1;min-height:0;display:flex;flex-direction:column")}>
      <div style={css("height:44px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 8px")}>
        <a href={backHref} style={css("height:44px;padding:0 8px;display:flex;align-items:center;gap:4px;font-size:16px;font-weight:500;color:var(--acc-ink)")}><Icon id="backchev" size={18} />{backLabel}</a>
        {first && <a href={first.url} target="_blank" rel="noopener" style={css("height:44px;padding:0 12px;display:flex;align-items:center;gap:6px;font-size:14px;font-weight:500;color:var(--acc-ink)")}>{first.name}<Icon id="ext" /></a>}
      </div>
      <div style={css("flex:1;min-height:0;background:var(--sheet);border-radius:16px 16px 0 0;box-shadow:var(--sh1);overflow:hidden;display:flex;flex-direction:column")}>
        <div style={css("flex:1;min-height:0;overflow-y:auto;padding:40px 16px 24px")}>
          <div style={css("position:relative;background:var(--raised);border-radius:16px;box-shadow:var(--sh2);padding:32px 16px 16px")}>
            <div style={{ ...css("position:absolute;left:16px;top:-24px;width:48px;height:48px;border-radius:10px;font-size:20px;font-weight:600;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 4px var(--sheet), var(--sh1)"), background: t.tileBg, color: t.tileInk }}>{initial(p.company)}</div>
            <div style={css("position:absolute;right:16px;top:12px;text-align:right")}>
              <div style={css(`font-size:24px;font-weight:600;line-height:32px;color:${scoreColor(p.score, app.prefs!)}`)}>{p.score}</div>
              <div style={css("font-size:12px;color:var(--ink3)")}>match</div>
            </div>
            <div style={css("padding-right:56px")}>
              <div style={css("font-size:20px;font-weight:600;line-height:28px;letter-spacing:-0.01em")}>{p.title}</div>
              <a href={`#/companies/${encodeURIComponent(p.companyKey)}`} style={css("display:block;margin-top:4px;font-size:13px;font-weight:500;color:var(--ink)")}>{p.company}</a>
              <div style={css("margin-top:2px;font-size:13px;color:var(--ink3)")}>{sourceText(p)}</div>
            </div>
          </div>
          {p.closedAt && (
            <p style={css("margin:16px 0 0;display:flex;gap:8px;font-size:13px;color:var(--ink2)")}><Icon id="alert" style={css("color:var(--warn);flex:none;margin-top:1px")} />Closed at source. Actions still work.</p>
          )}
          <div style={css("margin-top:24px;font-size:14px;font-weight:600")}>Key facts</div>
          <div style={css("font-size:13px;color:var(--ink3);margin-top:2px")}>Extracted automatically from the posting.</div>
          {facts(p).map((f, i) => (
            <div key={i} style={css("display:grid;grid-template-columns:16px minmax(0,1fr);column-gap:12px;padding:8px 0;border-bottom:1px solid var(--line)")}>
              <Icon id={f.i} style={css("color:var(--ink3);margin-top:2px")} />
              <div><div style={css(`font-size:14px;font-weight:${f.w};color:${f.w === 400 ? "var(--ink3)" : "var(--ink)"}`)}>{f.t}</div>{f.s && <div style={css("font-size:13px;color:var(--ink2)")}>{f.s}</div>}</div>
            </div>
          ))}
          {benefits(p).map((b, i) => (
            <div key={i} style={css("display:grid;grid-template-columns:16px minmax(0,1fr);column-gap:12px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px")}><Icon id="award" style={css("color:var(--ink3);margin-top:2px")} /><span>{b}</span></div>
          ))}
          {p.have.length > 0 && (
            <>
              <div style={css("margin-top:24px;font-size:14px;font-weight:600")}>Stack fit</div>
              <div style={css("margin-top:8px;font-size:12px;font-weight:500;color:var(--ink3)")}>You have</div>
              <div className="no-scrollbar" style={css("margin:8px -16px 0 0;display:flex;gap:8px;overflow-x:auto;white-space:nowrap")}>
                {p.have.map((c) => <span key={c} style={css("height:28px;flex:none;padding:0 10px;border-radius:6px;background:var(--sunk);box-shadow:inset 0 0 0 1px var(--line);font-size:13px;display:inline-flex;align-items:center;gap:6px")}><Icon id="check" style={css("color:var(--ok)")} />{c}</span>)}
              </div>
            </>
          )}
          {p.gap.length > 0 && (
            <>
              <div style={css("margin-top:12px;font-size:12px;font-weight:500;color:var(--ink3)")}>Gap</div>
              <div style={css("margin-top:8px;display:flex;gap:8px;flex-wrap:wrap")}>{p.gap.map((c) => <span key={c} style={css("height:28px;padding:0 10px;border-radius:6px;background:var(--warn-bg);color:var(--warn);font-size:13px;display:inline-flex;align-items:center")}>{c}</span>)}</div>
            </>
          )}
          {desc && (
            <>
              <div style={css("margin-top:24px;font-size:14px;font-weight:600")}>Original description</div>
              <p lang="vi" style={css("margin:8px 0 0;font-size:14px;line-height:22px;white-space:pre-line")}>
                {segments(desc.description, desc.terms).map((g, i) => <span key={i} style={css(`font-weight:${g.hit ? 600 : 400}`)}>{g.t}</span>)}
              </p>
            </>
          )}
        </div>
        <div style={css("flex:none;display:flex;gap:8px;padding:12px 16px 20px;border-top:1px solid var(--line);background:var(--sheet)")}>
          <button onClick={() => app.openApplied(p.id)} style={css("flex:1.3;height:44px;border:0;border-radius:10px;background:var(--btn);color:var(--btn-ink);font-size:15px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:8px")}><Icon id="send" />Applied</button>
          <button onClick={() => app.act("interested", p.id)} style={css("flex:1;height:44px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);box-sizing:border-box;font-size:15px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:6px")}><Icon id="mark" />Interested</button>
          <button onClick={() => app.act("skipped", p.id)} style={css("flex:.8;height:44px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);box-sizing:border-box;font-size:15px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:6px")}><Icon id="x" />Skip</button>
        </div>
      </div>
    </div>
  );
}

const NEXT_STAGE: Record<string, [string, string] | undefined> = {
  Interested: ["applied", "Applied"], Applied: ["interviewing", "Interviewing"], Interviewing: ["offer", "Offer"], Skipped: ["interested", "Interested"],
};

function PhonePipeline({ app }: { app: App }) {
  const [seg, setSeg] = useState("Interested");
  const [showClosed, setShowClosed] = useState(false);
  const ps = app.data?.postings ?? [];
  const segs = ["Interested", "Applied", "Interviewing", "Offer", ...(showClosed ? ["Skipped", "Closed"] : [])];
  const items = ps.filter((p) => stage(p) === seg);
  return (
    <>
      <Title title="Pipeline" sub="Tracked applications by status." />
      <div className="no-scrollbar" style={css("padding:0 16px 12px;overflow-x:auto")}>
        <div style={css("display:flex;padding:2px;border-radius:10px;background:var(--sunk);box-shadow:inset 0 0 0 1px var(--line);min-width:max-content")}>
          {segs.map((s) => {
            const on = s === seg;
            return (
              <button key={s} onClick={() => setSeg(s)} style={css(`flex:1;height:40px;padding:0 10px;border:0;border-radius:8px;background:${on ? "var(--raised)" : "transparent"};box-shadow:${on ? "var(--sh1)" : "none"};font-size:13px;font-weight:500;color:${on ? "var(--ink)" : "var(--ink2)"};display:flex;align-items:center;justify-content:center;gap:4px;cursor:pointer`)}>
                {s}<span style={css("color:var(--ink3)")}>{ps.filter((p) => stage(p) === s).length}</span>
              </button>
            );
          })}
        </div>
      </div>
      <Sheet pad="16px">
        <div style={css("display:flex;flex-direction:column;gap:8px")}>
          {items.map((p) => {
            const next = NEXT_STAGE[seg];
            return (
              <div key={p.id} style={css("display:flex;flex-direction:column;gap:8px")}>
                <a href={`#/jobs/${p.id}`} style={css("display:block;padding:14px;border-radius:10px;border:1px solid var(--line);background:var(--raised);color:var(--ink);text-decoration:none")}><PipelineCard app={app} p={p} phone /></a>
                {next && (
                  <button onClick={() => app.moveTo(p, next[0])} style={css("height:44px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);box-sizing:border-box;font-size:14px;font-weight:500")}>Move to {next[1]}</button>
                )}
              </div>
            );
          })}
          {items.length === 0 && <p style={css("margin:4px;font-size:13px;color:var(--ink3)")}>No postings in this stage.</p>}
        </div>
        <div style={css("margin-top:16px;height:52px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);font-size:14px;color:var(--ink2)")}>
          Show Skipped and Closed<Switch on={showClosed} onClick={() => setShowClosed((v) => !v)} />
        </div>
      </Sheet>
    </>
  );
}

function PhoneSettings({ app, tab }: { app: App; tab: string | null }) {
  const prefs = app.prefs;
  if (!prefs) return null;
  if (tab) {
    return (
      <div style={css("flex:1;min-height:0;display:flex;flex-direction:column")}>
        <div style={css("height:44px;display:flex;align-items:center;padding:0 8px")}>
          <a href="#/settings" style={css("height:44px;padding:0 8px;display:flex;align-items:center;gap:4px;font-size:16px;font-weight:500;color:var(--acc-ink)")}><Icon id="backchev" size={18} />Settings</a>
        </div>
        <div style={css("flex:1;min-height:0;overflow-y:auto;background:var(--sheet);border-radius:16px 16px 0 0;box-shadow:var(--sh1);padding:20px 16px 32px")}>
          <SettingsBody app={app} tab={tab} prefs={prefs} />
        </div>
      </div>
    );
  }
  const unhealthy = app.data?.sources.filter((s) => s.status !== "Healthy").length ?? 0;
  const rows: [string, string, string][] = [
    ["Scoring", `Inbox from ${prefs.inboxMin}`, "#/settings/scoring"],
    ["Search", `${prefs.keywords.length} keywords`, "#/settings/search"],
    ["Watchlist", `${app.watched.size} companies`, "#/settings/watchlist"],
    ["Display", prefs.defaultSort === "match" ? "Sort by match" : "Sort by newest", "#/settings/display"],
    ["Sources", unhealthy ? `${unhealthy} need attention` : "All healthy", "#/sources"],
  ];
  return (
    <>
      <Title title="Settings" />
      <div style={css("margin:0 16px;background:var(--sheet);border-radius:16px;box-shadow:var(--sh1);overflow:hidden")}>
        {rows.map(([l, v, href]) => (
          <a key={l} href={href} style={css("height:56px;display:flex;align-items:center;gap:12px;padding:0 12px 0 16px;border-bottom:1px solid var(--line);color:var(--ink);text-decoration:none")}>
            <span style={css("flex:1;font-size:16px")}>{l}</span><span style={css("font-size:13px;color:var(--ink3)")}>{v}</span><Icon id="chev" style={css("color:var(--ink3)")} />
          </a>
        ))}
      </div>
      <div style={css("flex:1")} />
    </>
  );
}

// Screens without a phone drawing reuse the desktop screen inside the phone sheet.
export function PhoneShell({ app, desktop }: { app: App; desktop: ReactNode }) {
  const r = app.route;
  let body: ReactNode;
  if (r.name === "inbox") body = <PhoneInbox app={app} />;
  else if (r.name === "postings") body = <PhonePostings app={app} />;
  else if (r.name === "pipeline") body = <PhonePipeline app={app} />;
  else if (r.name === "settings") body = <PhoneSettings app={app} tab={location.hash.replace(/^#\/?/, "").split("/")[1] ? r.tab : null} />;
  else if (r.name === "posting") body = app.current ? <PhonePosting app={app} p={app.current} /> : null;
  else body = <div style={css("flex:1;min-height:0;margin:12px 16px 0;background:var(--sheet);border-radius:16px 16px 0 0;box-shadow:var(--sh1);overflow:hidden;display:flex;flex-direction:column")}>{desktop}</div>;
  return (
    <div style={css("height:100dvh;display:flex;flex-direction:column;background:radial-gradient(500px 500px at 0 0, var(--wash), transparent 70%), var(--canvas);color:var(--ink)")}>
      <div style={css("flex:1;min-height:0;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top)")}>{body}</div>
      {r.name !== "posting" && <TabBar app={app} />}
    </div>
  );
}
