// Screen 02 Inbox: the triage list beside the open posting, as in the export.
import { css } from "./css";
import { Icon } from "./icons";
import { kbd } from "./shell";
import type { App } from "./app";
import { ageText, chips, place, postedIso, salaryText, scoreColor, sourceText, tile, initial } from "./model";
import { PostingDetail } from "./posting-detail";

const ROW_GRID = "position:relative;height:84px;box-sizing:border-box;padding:10px 16px 10px 20px;display:grid;grid-template-columns:32px minmax(0,1fr) 40px;column-gap:12px;cursor:pointer;border-bottom:1px solid var(--line)";

function Skeleton() {
  return (
    <>
      {[62, 78, 54, 70, 66, 48, 74, 58, 68].map((w, i) => (
        <div key={i} style={css("height:84px;box-sizing:border-box;padding:10px 16px 10px 20px;display:grid;grid-template-columns:32px minmax(0,1fr) 36px;column-gap:12px;border-bottom:1px solid var(--line);animation:jr-pulse 1400ms ease-in-out infinite")}>
          <div style={css("width:32px;height:32px;border-radius:6px;background:var(--sunk)")} />
          <div style={css("display:flex;flex-direction:column;gap:8px;padding-top:4px")}>
            <div style={css(`height:12px;width:${w}%;border-radius:6px;background:var(--sunk)`)} />
            <div style={css(`height:10px;width:${w - 18}%;border-radius:6px;background:var(--sunk)`)} />
            <div style={css("display:flex;gap:6px;margin-top:4px")}>
              <div style={css("height:20px;width:88px;border-radius:6px;background:var(--sunk)")} />
              <div style={css("height:20px;width:72px;border-radius:6px;background:var(--sunk)")} />
            </div>
          </div>
          <div style={css("height:16px;width:28px;border-radius:6px;background:var(--sunk);justify-self:end;margin-top:4px")} />
        </div>
      ))}
    </>
  );
}

function RowAction({ icon, k, title, onClick }: { icon: string; k: string; title: string; onClick: () => void }) {
  return (
    <button title={title} className="hv-ctl press" onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={css("height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--line2);background:var(--sheet);font-size:12px;color:var(--ink);display:flex;align-items:center;gap:6px;cursor:pointer")}>
      <Icon id={icon} />
      <kbd style={css("font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ink3)")}>{k}</kbd>
    </button>
  );
}

export function inboxSubtitle(app: App): string {
  const { inbox, data, prefs } = app;
  if (!data) return "Checking for new postings…";
  if (!inbox.length) return "Nothing waiting";
  return `${inbox.length} new in the last ${prefs!.newDays} days`;
}

export function InboxScreen({ app }: { app: App }) {
  const { inbox, current, data, prefs, hover, leaving, seen, now, compact } = app;
  const loading = !data;
  const empty = !loading && inbox.length === 0;
  const listW = Math.round(Math.max(340, Math.min(456, (app.vw - (compact ? 64 : 232) - 24) * 0.42)));
  return (
    <div style={css("flex:1;min-height:0;display:flex")}>
      {!empty && (
        <section style={css(`width:${listW}px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--line);min-height:0`)}>
          <div style={css("padding:20px 20px 16px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line)")}>
            <div>
              <h1 style={css("margin:0;font-size:24px;font-weight:600;letter-spacing:-0.01em")}>Inbox</h1>
              <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3);white-space:nowrap")}>{inboxSubtitle(app)}</p>
            </div>
            <SortSwitch app={app} />
          </div>
          <div style={css("flex:1;min-height:0;overflow-y:auto;padding:4px 0")}>
            {loading && <Skeleton />}
            {inbox.map((p) => {
              const sel = p.id === current?.id;
              const hov = hover === p.id;
              const lv = leaving === p.id;
              const salary = salaryText(p);
              return (
                <div key={p.id} onClick={() => { app.setSel(p.id); app.markSeen(p.id); }} onMouseEnter={() => app.setHover(p.id)} onMouseLeave={() => hover === p.id && app.setHover(null)}
                  style={css(`${ROW_GRID};border-radius:${sel ? "10px" : "0"};background:${sel ? "var(--raised)" : hov ? "var(--hover)" : "transparent"};box-shadow:${sel ? "var(--sh15)" : "none"};z-index:${sel ? 2 : 1};transform:${lv ? "translateX(-24px)" : sel ? "translateY(-1px)" : "none"};opacity:${lv ? 0 : 1};transition:background 160ms ease-out, box-shadow 160ms ease-out, transform 180ms ease-out, opacity 180ms ease-out`)}>
                  <span style={css(`position:absolute;left:6px;top:14px;bottom:14px;width:2px;border-radius:9999px;background:var(--accent);opacity:${sel ? 1 : 0}`)} />
                  <div style={{ ...css("width:32px;height:32px;border-radius:6px;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;margin-top:2px"), background: tile(p.companyKey).tileBg, color: tile(p.companyKey).tileInk }}>{initial(p.company)}</div>
                  <div style={css("min-width:0;display:flex;flex-direction:column")}>
                    <div style={css("height:20px;display:flex;align-items:center;gap:6px;min-width:0")}>
                      {!seen.has(p.id) && <span aria-label="New" style={css("width:6px;height:6px;flex:none;border-radius:9999px;background:var(--accent)")} />}
                      <span style={css(`font-size:14px;font-weight:${seen.has(p.id) ? 500 : 600};color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{p.title}</span>
                    </div>
                    <div style={css("height:18px;font-size:12px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{`${p.company} · ${place(p)} · ${sourceText(p)}`}</div>
                    <div style={css("height:20px;margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;column-gap:6px;row-gap:8px;overflow:hidden")}>
                      <span style={css(`height:20px;line-height:20px;max-width:100%;font-size:13px;font-weight:${salary ? 500 : 400};color:${salary ? "var(--ink)" : "var(--ink3)"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{salary ?? "Salary not shown"}</span>
                      {chips(p).map((c, i) => (
                        <span key={i} style={css("height:20px;padding:0 6px;border-radius:6px;background:var(--sunk);font-size:12px;color:var(--ink2);display:inline-flex;align-items:center;gap:4px;flex:none")}>
                          <span style={css(`color:${c.col};font-weight:600`)}>{c.sign}</span>{c.t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={css("display:flex;flex-direction:column;align-items:flex-end")}>
                    <span style={css(`height:20px;font-size:16px;font-weight:600;color:${scoreColor(p.score, prefs!)}`)}>{p.score}</span>
                    <span style={css("font-size:11px;color:var(--ink3);white-space:nowrap")}>{ageText(postedIso(p), now)}</span>
                  </div>
                  {hov && !lv && (
                    <div style={css(`position:absolute;right:12px;bottom:9px;display:flex;gap:4px;padding-left:8px;background:${sel ? "var(--raised)" : "var(--hover)"};animation:jr-fade 150ms ease-out`)}>
                      <RowAction icon="mark" k="i" title="Interested" onClick={() => app.act("interested", p.id)} />
                      <RowAction icon="x" k="s" title="Skip" onClick={() => app.act("skipped", p.id)} />
                      <RowAction icon="send" k="a" title="Applied" onClick={() => app.openApplied(p.id)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={css("height:40px;flex:none;border-top:1px solid var(--line);display:flex;align-items:center;gap:16px;padding:0 20px;font-size:12px;color:var(--ink3)")}>
            <span style={css("display:flex;align-items:center;gap:4px")}><kbd style={kbd}>j</kbd><kbd style={kbd}>k</kbd>Move</span>
            <span style={css("display:flex;align-items:center;gap:4px")}><kbd style={kbd}>o</kbd>Open source</span>
            <span style={css("display:flex;align-items:center;gap:4px")}><kbd style={kbd}>⌘K</kbd>Commands</span>
          </div>
        </section>
      )}
      {empty && (
        <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px")}>
          <p style={css("margin:0;font-size:14px;color:var(--ink2)")}>Nothing new in the last {prefs!.newDays} days.</p>
          <a href="#/postings" style={css("font-size:13px;font-weight:500")}>See all postings</a>
        </div>
      )}
      {loading && (
        <div style={css("flex:1;padding:40px 20px 20px;animation:jr-pulse 1400ms ease-in-out infinite")}>
          <div style={css("height:168px;border-radius:16px;background:var(--sunk)")} />
        </div>
      )}
      {!loading && !empty && current && <PostingDetail app={app} p={current} wide={false} />}
    </div>
  );
}

export function SortSwitch({ app, phone = false }: { app: App; phone?: boolean }) {
  return (
    <div role="tablist" style={css(`display:flex;padding:2px;border-radius:10px;background:var(--sunk);box-shadow:inset 0 0 0 1px var(--line)${phone ? ";flex:1" : ""}`)}>
      {(["match", "newest"] as const).map((k) => {
        const on = app.sort === k;
        return (
          <button key={k} role="tab" aria-selected={on} onClick={() => app.setSort(k)} className="press"
            style={css(`${phone ? "flex:1;height:40px;font-size:14px" : "height:28px;font-size:13px"};padding:0 10px;border:0;border-radius:8px;font-weight:500;cursor:pointer;color:${on ? "var(--ink)" : "var(--ink2)"};background:${on ? "var(--raised)" : "transparent"};box-shadow:${on ? "var(--sh1)" : "none"};transition:background 150ms ease-out, color 150ms ease-out`)}>
            {k === "match" ? "Match" : "Newest"}
          </button>
        );
      })}
    </div>
  );
}
