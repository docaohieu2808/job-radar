// Screen 09 Sources: where postings come from and whether each check is working.
import { useState } from "react";
import { css } from "./css";
import { Icon } from "./icons";
import type { App } from "./app";
import { api } from "./api";
import { clock } from "./model";

const GRID = "display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1.2fr) 120px 112px 120px 80px 32px;column-gap:16px;padding:0 24px";
const STATUS_COLOR = { Healthy: "var(--ok)", Degraded: "var(--warn)", Blocked: "var(--bad)" } as const;

export function SourcesScreen({ app }: { app: App }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const data = app.data;
  if (!data) return null;
  const u = data.usage;
  const usage = [
    { label: "Pages checked today", n: u.pagesToday.toLocaleString("en-US"), of: null as string | null, w: 0, note: u.lastChecked ? `Last checked ${clock(u.lastChecked)}` : "" },
    { label: "LinkedIn postings read today", n: String(u.linkedinToday), of: String(u.linkedinLimit), w: (u.linkedinToday / u.linkedinLimit) * 100, note: "Kept low so LinkedIn does not block the crawler · resets at 07:00" },
  ];
  const check = async (id: string, name: string) => {
    setChecking(id);
    try {
      const r = await api.checkSource(id);
      app.showToast({ text: r.message });
      void app.reload();
    } catch {
      app.showToast({ text: `${name}: the check did not finish` });
    } finally {
      setChecking(null);
    }
  };
  return (
    <div style={css("flex:1;min-height:0;overflow-y:auto")}>
      <div style={css("padding:20px 24px 16px")}>
        <h1 style={css("margin:0;font-size:24px;font-weight:600;letter-spacing:-0.01em")}>Sources</h1>
        <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>Where postings come from and whether each check is working.</p>
      </div>
      <div className="usage-grid" style={css("display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line);border-bottom:1px solid var(--line)")}>
        {usage.map((x) => (
          <div key={x.label} style={css("padding:20px 24px;border-right:1px solid var(--line)")}>
            <div style={css("font-size:13px;font-weight:500;color:var(--ink2)")}>{x.label}</div>
            <div style={css("margin-top:4px;display:flex;align-items:baseline;gap:6px")}>
              <span style={css("font-size:24px;font-weight:600")}>{x.n}</span>
              {x.of && <span style={css("font-size:13px;color:var(--ink3)")}>of {x.of} daily limit</span>}
            </div>
            {x.of && <div style={css("margin-top:12px;height:4px;border-radius:9999px;background:var(--sunk)")}><div style={css(`height:4px;width:${Math.min(100, x.w)}%;border-radius:9999px;background:var(--ink)`)} /></div>}
            {x.note && <div style={css("margin-top:8px;font-size:12px;color:var(--ink3)")}>{x.note}</div>}
          </div>
        ))}
      </div>
      <div className="src-grid" style={css(`${GRID};height:32px;align-items:center;border-bottom:1px solid var(--line);font-size:12px;color:var(--ink3);font-weight:500`)}>
        <span>Source</span><span>Kind</span><span>Status</span><span>Last checked</span><span style={css("text-align:right")}>Seen last 24 h</span><span style={css("text-align:right")}>Errors</span><span />
      </div>
      {data.sources.map((s) => {
        const can = Boolean(s.error);
        const isOpen = can && (open[s.id] ?? s.status !== "Healthy");
        const color = STATUS_COLOR[s.status];
        return (
          <div key={s.id} style={css("border-bottom:1px solid var(--line)")}>
            <button onClick={() => can && setOpen((o) => ({ ...o, [s.id]: !isOpen }))} disabled={!can} aria-expanded={isOpen} className="hv-row src-grid"
              style={css(`width:100%;${GRID};height:48px;align-items:center;border:0;background:transparent;text-align:left;cursor:${can ? "pointer" : "default"};transition:background 150ms ease-out`)}>
              <span style={css("min-width:0")}>
                <span style={css("font-size:14px;font-weight:500;color:var(--ink)")}>{s.name}</span>
                {s.note && <span style={css("font-size:12px;color:var(--ink3)")}> · {s.note}</span>}
              </span>
              <span style={css("font-size:13px;color:var(--ink2)")}>{s.kind}</span>
              <span style={css(`display:flex;align-items:center;gap:6px;font-size:13px;color:${color};font-weight:500`)}>
                <span style={css(`width:6px;height:6px;border-radius:9999px;background:${color}`)} />{s.status}
              </span>
              <span style={css("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink2)")}>{s.lastRun ? clock(s.lastRun) : "Not yet"}</span>
              <span style={css("text-align:right;font-size:13px")}>{s.seen24h}</span>
              <span style={css(`text-align:right;font-size:13px;color:${s.errors ? "var(--ink)" : "var(--ink3)"}`)}>{s.errors ? String(s.errors) : "None"}</span>
              {can && <Icon id="chev" style={css(`color:var(--ink3);transform:${isOpen ? "rotate(90deg)" : "none"};transition:transform 150ms ease-out`)} />}
            </button>
            {isOpen && (
              <div style={css("padding:0 24px 16px 24px;display:flex;align-items:flex-start;gap:12px;animation:jr-in 150ms ease-out")}>
                <Icon id="alert" style={css(`color:${color};flex:none;margin-top:2px`)} />
                <div style={css("flex:1")}>
                  <div style={css("font-size:14px;color:var(--ink)")}>{s.error}</div>
                  <div style={css("margin-top:2px;font-size:13px;color:var(--ink3)")}>{s.errorDetail}</div>
                </div>
                {s.id !== "career" && <button onClick={() => void check(s.id, s.name)} disabled={checking === s.id} className="hv-ctl press"
                  style={css("height:32px;min-width:104px;padding:0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);font-size:13px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer")}>
                  {checking === s.id && <span style={css("width:12px;height:12px;border-radius:9999px;border:2px solid currentColor;border-right-color:transparent;box-sizing:border-box;animation:jr-spin 700ms linear infinite")} />}
                  {checking === s.id ? "Checking" : s.status === "Blocked" ? "Try now" : "Check now"}
                </button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
