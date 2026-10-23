// Screen 05 Pipeline: tracked postings in status columns, moved by drag and drop.
import { useState } from "react";
import { css } from "./css";
import { Icon } from "./icons";
import type { App } from "./app";
import type { PostingView } from "./api";
import { STATUS_COLOR, daysAgo, salaryText, stage, tile, initial } from "./model";

const STAGE_STATUS: Record<string, string> = { Interested: "interested", Applied: "applied", Interviewing: "interviewing", Offer: "offer", Skipped: "skipped" };

export function stageDays(p: PostingView, app: App): string {
  const d = daysAgo(p.statusAt, app.now);
  return d === 0 ? "Moved here today" : d === 1 ? "1 day in stage" : `${d} days in stage`;
}

export function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      style={css(`width:32px;height:18px;padding:2px;border:0;border-radius:9999px;background:${on ? "var(--btn)" : "var(--line2)"};cursor:pointer;display:flex;transition:background 150ms ease-out`)}>
      <span style={css(`width:14px;height:14px;border-radius:9999px;background:#fff;box-shadow:0 1px 2px rgb(0 0 0 / .2);transform:${on ? "translateX(14px)" : "none"};transition:transform 150ms ease-out`)} />
    </button>
  );
}

export function PipelineCard({ app, p, phone = false }: { app: App; p: PostingView; phone?: boolean }) {
  const t = tile(p.companyKey);
  const salary = salaryText(p);
  return (
    <>
      <div style={css("display:flex;align-items:center;gap:8px")}>
        <span style={{ ...css("width:20px;height:20px;border-radius:6px;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center"), background: t.tileBg, color: t.tileInk }}>{initial(p.company)}</span>
        <span style={css("flex:1;font-size:12px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.company}</span>
        {!phone && <Icon id="grip" style={css("color:var(--ink3)")} />}
      </div>
      <div style={css(`margin-top:8px;font-size:${phone ? 16 : 14}px;font-weight:500`)}>{p.title}</div>
      <div style={css(`margin-top:2px;font-size:13px;color:${salary ? "var(--ink)" : "var(--ink3)"}`)}>{salary ?? "Salary not shown"}</div>
      {p.note && <div style={css("margin-top:8px;font-size:13px;color:var(--ink2)")}>{p.note}</div>}
      <div style={css("margin-top:8px;font-size:12px;color:var(--ink3)")}>{stageDays(p, app)}</div>
    </>
  );
}

export function PipelineScreen({ app }: { app: App }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const ps = app.data?.postings ?? [];
  const cols = ["Interested", "Applied", "Interviewing", "Offer", ...(showClosed ? ["Skipped", "Closed"] : [])];
  return (
    <div style={css("flex:1;min-height:0;display:flex;flex-direction:column")}>
      <div style={css("padding:20px 24px 16px;display:flex;align-items:flex-end;justify-content:space-between;border-bottom:1px solid var(--line)")}>
        <div>
          <h1 style={css("margin:0;font-size:24px;font-weight:600;letter-spacing:-0.01em")}>Pipeline</h1>
          <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>Tracked applications by status. Drag a card to move it.</p>
        </div>
        <label style={css("display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2);cursor:pointer")}>
          <Switch on={showClosed} onClick={() => setShowClosed((v) => !v)} />
          Show Skipped and Closed
        </label>
      </div>
      <div style={css(`flex:1;min-height:0;display:grid;grid-template-columns:repeat(${cols.length}, minmax(220px, 1fr));overflow-x:auto`)}>
        {cols.map((c) => {
          const items = ps.filter((p) => stage(p) === c).sort((a, b) => b.statusAt.localeCompare(a.statusAt));
          const droppable = c !== "Closed";
          return (
            <div key={c}
              onDragOver={(e) => { if (!droppable) return; e.preventDefault(); if (over !== c) setOver(c); }}
              onDrop={(e) => {
                e.preventDefault();
                const p = drag !== null ? app.byId.get(drag) : undefined;
                if (p && droppable && stage(p) !== c) app.moveTo(p, STAGE_STATUS[c]);
                setDrag(null);
                setOver(null);
              }}
              style={css(`min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--line);background:${over === c && drag !== null ? "var(--hover)" : "transparent"};transition:background 150ms ease-out`)}>
              <div style={css("height:44px;flex:none;display:flex;align-items:center;gap:8px;padding:0 16px")}>
                <span style={css(`width:6px;height:6px;border-radius:9999px;background:${STATUS_COLOR[c]}`)} />
                <span style={css("font-size:13px;font-weight:600")}>{c}</span>
                <span style={css("font-size:13px;color:var(--ink3)")}>{items.length}</span>
              </div>
              <div style={css("flex:1;overflow-y:auto;padding:0 12px 16px;display:flex;flex-direction:column;gap:8px")}>
                {items.map((p) => (
                  <a key={p.id} href={`#/jobs/${p.id}`} draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(p.id)); setDrag(p.id); }}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                    className="hv-line2"
                    style={css(`display:block;padding:12px;border-radius:10px;background:var(--raised);box-shadow:${drag === p.id ? "var(--sh2)" : "none"};border:1px solid var(--line);color:var(--ink);text-decoration:none;cursor:grab;transform:${drag === p.id ? "translateY(-2px)" : "none"};transition:box-shadow 160ms ease-out, transform 160ms ease-out`)}>
                    <PipelineCard app={app} p={p} />
                  </a>
                ))}
                {items.length === 0 && <p style={css("margin:4px 4px;font-size:13px;color:var(--ink3)")}>No postings in this stage.</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
