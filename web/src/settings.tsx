// Screen 10 Settings: one screen per tab with its own URL (Scoring, Search, Watchlist, Display).
import { useEffect, useState } from "react";
import { css } from "./css";
import { Icon } from "./icons";
import { SETTINGS_TABS, type App } from "./app";
import { DEFAULT_WEIGHTS, type Weights } from "../../src/score-weights";
import type { Prefs } from "../../src/prefs";
import { inInbox, rescore, scoreColor, tile, initial } from "./model";
import { Switch } from "./pipeline";
import { companies } from "./companies";
import { normalizeKey } from "../../src/normalize-key";

const WL: Record<keyof Weights, [string, string]> = {
  salary: ["Salary", "Published salary against the target range"],
  stack: ["Stack", "Skills named in the posting that are in the stack"],
  level: ["Level", "Seniority and years of experience asked"],
  english: ["English", "Required English level, Vietnamese postings"],
  benefits: ["Benefits", "Certification sponsorship, onsite abroad, training"],
};

const RANGE = css("width:100%;accent-color:var(--btn)");

function Scoring({ app, prefs }: { app: App; prefs: Prefs }) {
  const [w, setW] = useState<Weights>(prefs.weights);
  const [inboxMin, setInboxMin] = useState(prefs.inboxMin);
  const [topMin, setTopMin] = useState(prefs.topMin);
  useEffect(() => {
    setW(prefs.weights);
    setInboxMin(prefs.inboxMin);
    setTopMin(prefs.topMin);
  }, [prefs]);
  // The Inbox candidates as they would be with the weights on screen.
  const draft = { ...prefs, weights: w, inboxMin, topMin };
  const candidates = (app.data?.postings ?? []).filter((p) => inInbox({ ...p, score: 100 }, prefs, app.watched, app.now));
  const today = candidates.map((p) => ({ p, s: rescore(p, w) })).sort((a, b) => b.s - a.s);
  const pass = today.filter((x) => x.s >= inboxMin || app.watched.has(x.p.companyKey)).length;
  const top = today.filter((x) => x.s >= topMin).length;
  return (
    <>
      <h2 style={css("margin:0;font-size:20px;font-weight:600")}>Scoring</h2>
      <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>How much each factor counts toward the match score.</p>
      <div style={css("margin-top:20px;padding:12px 16px;border-radius:10px;background:var(--sunk);font-size:14px;color:var(--ink)")}>
        With these weights, <strong style={css("font-weight:600")}>{pass} of {today.length} recent postings</strong> reach the Inbox and {top} are top matches.
      </div>
      <div style={css("margin-top:24px")}>
        {(Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]).map((k) => (
          <div key={k} className="set-row" style={css("display:grid;grid-template-columns:minmax(0,1fr) 220px 40px;column-gap:16px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)")}>
            <div><div style={css("font-size:14px;font-weight:500")}>{WL[k][0]}</div><div style={css("font-size:13px;color:var(--ink3)")}>{WL[k][1]}</div></div>
            <input type="range" min={0} max={50} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} aria-label={WL[k][0]} style={RANGE} />
            <span style={css("text-align:right;font-size:14px;font-weight:500")}>{w[k]}</span>
          </div>
        ))}
      </div>
      <h3 style={css("margin:32px 0 0;font-size:14px;font-weight:600")}>Thresholds</h3>
      <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>Minimum match for a posting to enter the Inbox, and the match shown as a top match.</p>
      {([["Inbox minimum", inboxMin, setInboxMin], ["Top match from", topMin, setTopMin]] as const).map(([label, v, set]) => (
        <div key={label} className="set-row" style={css("display:grid;grid-template-columns:minmax(0,1fr) 220px 40px;column-gap:16px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)")}>
          <div style={css("font-size:14px;font-weight:500")}>{label}</div>
          <input type="range" min={0} max={100} value={v} onChange={(e) => set(Number(e.target.value))} aria-label={label} style={RANGE} />
          <span style={css("text-align:right;font-size:14px;font-weight:500")}>{v}</span>
        </div>
      ))}
      <h3 style={css("margin:32px 0 0;font-size:14px;font-weight:600")}>Preview</h3>
      <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>Recent untriaged postings rescored with the weights above.</p>
      <div style={css("margin-top:8px")}>
        {today.slice(0, 12).map(({ p, s }) => {
          const tag = s >= topMin ? "Top match" : s >= inboxMin || app.watched.has(p.companyKey) ? "Inbox" : "Below minimum";
          return (
            <div key={p.id} style={css(`display:grid;grid-template-columns:minmax(0,1fr) 120px 40px;column-gap:16px;align-items:center;height:36px;border-bottom:1px solid var(--line);font-size:13px;opacity:${tag === "Below minimum" ? 0.6 : 1}`)}>
              <span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.company} · {p.title}</span>
              <span style={css("color:var(--ink3)")}>{tag}</span>
              <span style={css(`text-align:right;font-weight:600;color:${scoreColor(s, draft)}`)}>{s}</span>
            </div>
          );
        })}
      </div>
      <div style={css("margin-top:24px;display:flex;gap:8px")}>
        <button onClick={() => void app.savePrefs({ ...prefs, weights: w, inboxMin, topMin }, "Weights saved")} className="hv-btn press"
          style={css("height:36px;padding:0 14px;border:0;border-radius:10px;background:var(--btn);color:var(--btn-ink);font-size:14px;font-weight:500;cursor:pointer")}>Save weights</button>
        <button onClick={() => { setW(DEFAULT_WEIGHTS); setInboxMin(60); setTopMin(85); }} className="hv-row press"
          style={css("height:36px;padding:0 12px;border:0;border-radius:10px;background:transparent;font-size:14px;font-weight:500;color:var(--ink2);cursor:pointer")}>Reset to defaults</button>
      </div>
    </>
  );
}

function Search({ app, prefs }: { app: App; prefs: Prefs }) {
  const [draft, setDraft] = useState("");
  const save = (next: Partial<Prefs>) => void app.savePrefs({ ...prefs, ...next });
  return (
    <>
      <h2 style={css("margin:0;font-size:20px;font-weight:600")}>Search</h2>
      <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>What the crawler keeps from every source.</p>
      <h3 style={css("margin:28px 0 0;font-size:14px;font-weight:600")}>Keywords</h3>
      <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>A posting matches when its title contains any of these.</p>
      <div style={css("margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center")}>
        {prefs.keywords.map((k) => (
          <span key={k} style={css("height:28px;padding:0 4px 0 10px;border-radius:6px;background:var(--sunk);box-shadow:inset 0 0 0 1px var(--line);font-size:13px;display:inline-flex;align-items:center;gap:2px")}>
            {k}
            <button onClick={() => save({ keywords: prefs.keywords.filter((x) => x !== k) })} aria-label={`Remove ${k}`} className="hv-x"
              style={css("width:20px;height:20px;border:0;border-radius:4px;background:transparent;color:var(--ink3);display:flex;align-items:center;justify-content:center;cursor:pointer")}>
              <Icon id="x" size={12} />
            </button>
          </span>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add keyword" className="fc-solid"
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { save({ keywords: [...prefs.keywords, draft.trim()] }); setDraft(""); } }}
          style={css("width:140px;height:28px;box-sizing:border-box;padding:0 10px;border-radius:6px;border:1px dashed var(--line2);background:transparent;font-size:13px")} />
      </div>
      <h3 style={css("margin:28px 0 0;font-size:14px;font-weight:600")}>Locations</h3>
      <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>Postings outside these places are not kept.</p>
      <div style={css("margin-top:12px;display:flex;gap:8px;flex-wrap:wrap")}>
        {["Ho Chi Minh City", "Remote, Vietnam"].map((k) => (
          <span key={k} style={css("height:28px;padding:0 10px;border-radius:6px;background:var(--sunk);box-shadow:inset 0 0 0 1px var(--line);font-size:13px;display:inline-flex;align-items:center")}>{k}</span>
        ))}
      </div>
      <h3 style={css("margin:28px 0 0;font-size:14px;font-weight:600")}>Work mode</h3>
      <div style={css("margin-top:8px")}>
        {(["remote", "hybrid", "onsite"] as const).map((m) => (
          <div key={m} style={css("display:flex;align-items:center;justify-content:space-between;height:48px;border-bottom:1px solid var(--line)")}>
            <span style={css("font-size:14px")}>{{ remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" }[m]}</span>
            <Switch on={prefs.modes[m]} label={m} onClick={() => save({ modes: { ...prefs.modes, [m]: !prefs.modes[m] } })} />
          </div>
        ))}
      </div>
    </>
  );
}

function Watchlist({ app }: { app: App }) {
  const [draft, setDraft] = useState("");
  const all = companies(app);
  const rows = (app.data?.companies ?? []).filter((c) => c.watch).map((c) => ({ ...c, agg: all.find((a) => a.key === c.key) }));
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    const match = all.find((c) => c.name.toLowerCase().includes(name.toLowerCase()));
    if (match) app.setWatch(match.name, match.key, true);
    else app.setWatch(name, normalizeKey(name), true);
    app.showToast({ text: `${match ? match.name : name} added to the watchlist` });
    setDraft("");
  };
  const empty = !draft.trim();
  return (
    <>
      <h2 style={css("margin:0;font-size:20px;font-weight:600")}>Watchlist</h2>
      <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>New postings from these companies always reach the Inbox, whatever their match.</p>
      <div style={css("margin-top:20px;display:flex;gap:8px")}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Company name" className="hv-ctl fc-acc"
          style={css("flex:1;height:32px;box-sizing:border-box;padding:0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);font-size:13px")} />
        <button onClick={add} disabled={empty}
          style={css(`height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;cursor:${empty ? "not-allowed" : "pointer"};opacity:${empty ? 0.5 : 1}`)}>
          <Icon id="plus" />Add
        </button>
      </div>
      <div style={css("margin-top:16px")}>
        {rows.map((c) => {
          const t = tile(c.key);
          const open = c.agg?.open ?? 0;
          return (
            <div key={c.key} style={css("display:flex;align-items:center;gap:12px;height:48px;border-bottom:1px solid var(--line)")}>
              <span style={{ ...css("width:28px;height:28px;border-radius:6px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center"), background: t.tileBg, color: t.tileInk }}>{initial(c.name)}</span>
              <a href={`#/companies/${encodeURIComponent(c.key)}`} style={css("flex:1;font-size:14px;font-weight:500;color:var(--ink)")}>{c.name}</a>
              <span style={css("font-size:13px;color:var(--ink3)")}>{open === 1 ? "1 open posting" : `${open} open postings`}</span>
              <button onClick={() => app.setWatch(c.name, c.key, false)} className="hv-bad press"
                style={css("height:32px;padding:0 10px;border:0;border-radius:10px;background:transparent;color:var(--bad);font-size:13px;font-weight:500;cursor:pointer")}>Remove</button>
            </div>
          );
        })}
        {rows.length === 0 && <p style={css("margin:12px 0 0;font-size:13px;color:var(--ink3)")}>No companies on the watchlist.</p>}
      </div>
    </>
  );
}

function Display({ app, prefs }: { app: App; prefs: Prefs }) {
  const [days, setDays] = useState(prefs.newDays);
  useEffect(() => setDays(prefs.newDays), [prefs.newDays]);
  return (
    <>
      <h2 style={css("margin:0;font-size:20px;font-weight:600")}>Display</h2>
      <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>How the Inbox is ordered and what counts as new.</p>
      <div style={css("margin-top:20px")}>
        <div style={css("display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--line)")}>
          <div><div style={css("font-size:14px;font-weight:500")}>Default sort</div><div style={css("font-size:13px;color:var(--ink3)")}>Used each time the Inbox opens.</div></div>
          <div role="tablist" style={css("display:flex;padding:2px;border-radius:10px;background:var(--sunk);box-shadow:inset 0 0 0 1px var(--line)")}>
            {(["match", "newest"] as const).map((k) => {
              const on = prefs.defaultSort === k;
              return (
                <button key={k} role="tab" aria-selected={on} className="press" onClick={() => { app.setSort(null); void app.savePrefs({ ...prefs, defaultSort: k }); }}
                  style={css(`height:28px;padding:0 10px;border:0;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;color:${on ? "var(--ink)" : "var(--ink2)"};background:${on ? "var(--raised)" : "transparent"};box-shadow:${on ? "var(--sh1)" : "none"}`)}>
                  {k === "match" ? "Match" : "Newest"}
                </button>
              );
            })}
          </div>
        </div>
        <div className="set-row" style={css("display:grid;grid-template-columns:minmax(0,1fr) 220px 56px;column-gap:16px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)")}>
          <div><div style={css("font-size:14px;font-weight:500")}>New for</div><div style={css("font-size:13px;color:var(--ink3)")}>Untriaged postings leave the Inbox after this many days. They stay in All postings.</div></div>
          <input type="range" min={1} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} onPointerUp={() => void app.savePrefs({ ...prefs, newDays: days })} onKeyUp={() => void app.savePrefs({ ...prefs, newDays: days })} aria-label="New for" style={RANGE} />
          <span style={css("text-align:right;font-size:14px;font-weight:500")}>{days} {days === 1 ? "day" : "days"}</span>
        </div>
      </div>
    </>
  );
}

export function SettingsScreen({ app, tab }: { app: App; tab: string }) {
  const prefs = app.prefs;
  if (!prefs) return null;
  return (
    <div style={css("flex:1;min-height:0;display:flex")}>
      <nav style={css("width:220px;flex:none;border-right:1px solid var(--line);padding:20px 12px;display:flex;flex-direction:column;gap:2px")}>
        <h1 style={css("margin:0 8px 16px;font-size:24px;font-weight:600;letter-spacing:-0.01em")}>Settings</h1>
        {SETTINGS_TABS.map(([k, l]) => {
          const on = tab === k;
          return (
            <a key={k} href={`#/settings/${k}`} aria-current={on ? "page" : undefined} className="hv-tab"
              style={css(`position:relative;height:28px;display:flex;align-items:center;padding:0 8px;border-radius:6px;font-size:13px;font-weight:500;color:${on ? "var(--ink)" : "var(--ink2)"};background:${on ? "var(--hover)" : "transparent"};text-decoration:none`)}>
              <span style={css(`position:absolute;left:-12px;top:6px;bottom:6px;width:2px;border-radius:9999px;background:var(--accent);opacity:${on ? 1 : 0}`)} />{l}
            </a>
          );
        })}
      </nav>
      <div style={css("flex:1;min-width:0;overflow-y:auto")}>
        <div style={css("max-width:680px;padding:28px 32px 48px")}>
          <SettingsBody app={app} tab={tab} prefs={prefs} />
        </div>
      </div>
    </div>
  );
}

export function SettingsBody({ app, tab, prefs }: { app: App; tab: string; prefs: Prefs }) {
  if (tab === "search") return <Search app={app} prefs={prefs} />;
  if (tab === "watchlist") return <Watchlist app={app} />;
  if (tab === "display") return <Display app={app} prefs={prefs} />;
  return <Scoring app={app} prefs={prefs} />;
}
