// Floating layer (L3) from the export: filter menu, command palette, Applied dialog, toast with Undo.
import { useEffect, useRef, useState } from "react";
import { css } from "./css";
import { Icon } from "./icons";
import type { App } from "./app";
import { filterDefs } from "./postings";

const KBD = css("min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:4px;border:1px solid var(--line2);background:var(--sunk);font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ink3);display:inline-flex;align-items:center;justify-content:center");

function FilterMenu({ app }: { app: App }) {
  const m = app.menu;
  if (!m) return null;
  const def = filterDefs(app).find((d) => d.k === m.k);
  if (!def) return null;
  return (
    <>
      <div onClick={() => app.setMenu(null)} style={css("position:fixed;inset:0;z-index:40")} />
      <div role="menu" style={css(`position:fixed;z-index:41;left:${m.x}px;top:${m.y}px;min-width:200px;padding:4px;border-radius:10px;background:var(--raised);box-shadow:var(--sh3);border:1px solid var(--line);animation:jr-in 150ms ease-out`)}>
        {def.o.map((o) => {
          const on = app.filters[def.k] === o;
          return (
            <button key={o} role="menuitemradio" aria-checked={on} className="hv-row" onClick={() => { app.setFilters({ ...app.filters, [def.k]: o }); app.setMenu(null); }}
              style={css("width:100%;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;font-size:13px;color:var(--ink);display:flex;align-items:center;gap:8px;text-align:left;cursor:pointer")}>
              <Icon id="check" style={css(`opacity:${on ? 1 : 0};color:var(--ink)`)} />{o}
            </button>
          );
        })}
      </div>
    </>
  );
}

type PalItem = { g: string; label: string; hint?: string; icon: string; run: () => void };

function palette(app: App, q: string): PalItem[] {
  const out: PalItem[] = [];
  const query = q.trim().toLowerCase();
  const add = (g: string, label: string, hint: string, icon: string, run: () => void) => {
    if (query && !label.toLowerCase().includes(query)) return;
    out.push({ g, label, hint, icon, run });
  };
  const cur = app.current;
  const r = app.route.name;
  if (cur && (r === "inbox" || r === "posting")) {
    add("Current posting", "Mark Interested", "i", "mark", () => app.act("interested"));
    add("Current posting", "Skip", "s", "x", () => app.act("skipped"));
    add("Current posting", "Mark Applied", "a", "send", () => app.openApplied());
    if (cur.sources[0]) add("Current posting", `Open on ${cur.sources[0].name}`, "o", "ext", () => app.openSource());
  }
  const nav: [string, string, string][] = [["Inbox", "#/inbox", "inbox"], ["All postings", "#/postings", "list"], ["Pipeline", "#/pipeline", "pipe"], ["Companies", "#/companies", "co"], ["Overview", "#/overview", "chart"], ["Sources", "#/sources", "src"], ["Settings", "#/settings/scoring", "set"]];
  for (const [label, href, icon] of nav) add("Go to", label, "", icon, () => app.go(href));
  if (query)
    for (const p of (app.data?.postings ?? []).filter((p) => `${p.title} ${p.company}`.toLowerCase().includes(query)).slice(0, 5))
      out.push({ g: "Postings", label: `${p.title} · ${p.company}`, hint: String(p.score), icon: "list", run: () => app.go(`#/jobs/${p.id}`) });
  add("Preferences", app.theme === "dark" ? "Switch to light theme" : "Switch to dark theme", "", "moon", () => app.setTheme(app.theme === "dark" ? "light" : "dark"));
  return out;
}

function Palette({ app }: { app: App }) {
  const [q, setQ] = useState("");
  const [pi, setPi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setQ("");
    setPi(0);
    window.setTimeout(() => ref.current?.focus(), 30);
  }, [app.pal]);
  if (!app.pal) return null;
  const items = palette(app, q);
  const run = (it: PalItem) => {
    app.setPal(false);
    it.run();
  };
  return (
    <>
      <div onClick={() => app.setPal(false)} style={css("position:fixed;inset:0;z-index:50;background:var(--scrim);animation:jr-fade 150ms ease-out")} />
      <div role="dialog" aria-label="Command palette" style={css(`position:fixed;z-index:51;left:50%;top:${app.phone ? "64px" : "120px"};width:${app.phone ? "calc(100vw - 32px)" : "560px"};transform:translateX(-50%);border-radius:16px;background:var(--raised);box-shadow:var(--sh3);overflow:hidden;animation:jr-pop 150ms ease-out`)}>
        <div style={css("height:48px;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--line)")}>
          <Icon id="search" size={18} style={css("color:var(--ink3)")} />
          <input ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setPi(0); }} placeholder="Type a command or search postings"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setPi(Math.min(items.length - 1, pi + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setPi(Math.max(0, pi - 1)); }
              else if (e.key === "Enter" && items[pi]) { e.preventDefault(); run(items[pi]); }
            }}
            style={css("flex:1;height:40px;border:0;background:transparent;font-size:14px;color:var(--ink);outline:none")} />
          <kbd style={KBD}>esc</kbd>
        </div>
        <div style={css("max-height:360px;overflow-y:auto;padding:4px 8px 8px")}>
          {items.map((it, i) => (
            <div key={`${it.g}-${it.label}`}>
              {(i === 0 || items[i - 1].g !== it.g) && <div style={css("padding:10px 8px 4px;font-size:12px;font-weight:500;color:var(--ink3)")}>{it.g}</div>}
              <button onClick={() => run(it)} onMouseEnter={() => pi !== i && setPi(i)}
                style={css(`width:100%;height:36px;padding:0 8px;border:0;border-radius:6px;background:${i === pi ? "var(--hover)" : "transparent"};font-size:14px;color:var(--ink);display:flex;align-items:center;gap:10px;text-align:left;cursor:pointer`)}>
                <Icon id={it.icon} style={css("color:var(--ink3);flex:none")} />
                <span style={css("flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{it.label}</span>
                {it.hint && <kbd style={KBD}>{it.hint}</kbd>}
              </button>
            </div>
          ))}
          {items.length === 0 && <p style={css("margin:16px 8px;font-size:13px;color:var(--ink3)")}>No commands or postings match.</p>}
        </div>
        <div style={css("height:36px;display:flex;align-items:center;gap:16px;padding:0 16px;border-top:1px solid var(--line);font-size:12px;color:var(--ink3)")}>
          <span>↑ ↓ to move</span><span>↵ to run</span>
        </div>
      </div>
    </>
  );
}

function AppliedDialog({ app }: { app: App }) {
  const [note, setNote] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setNote("");
    if (app.dlg !== null) window.setTimeout(() => ref.current?.focus(), 30);
  }, [app.dlg]);
  const p = app.dlg !== null ? app.byId.get(app.dlg) : undefined;
  if (!p) return null;
  const confirm = () => {
    const n = note.trim();
    app.setDlg(null);
    app.act("applied", p.id, n ? (n.startsWith("Next") ? n : `Next: ${n}`) : undefined);
  };
  return (
    <>
      <div onClick={() => app.setDlg(null)} style={css("position:fixed;inset:0;z-index:50;background:var(--scrim);animation:jr-fade 150ms ease-out")} />
      <div role="dialog" aria-label="Mark as Applied" style={css(`position:fixed;z-index:51;left:50%;top:50%;width:${app.phone ? "calc(100vw - 32px)" : "440px"};transform:translate(-50%,-50%);padding:24px;box-sizing:border-box;border-radius:16px;background:var(--raised);box-shadow:var(--sh3);animation:jr-pop 150ms ease-out`)}>
        <h2 style={css("margin:0;font-size:16px;font-weight:600")}>Mark as Applied</h2>
        <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>{p.company} · {p.title}</p>
        <label style={css("margin-top:20px;display:flex;flex-direction:column;gap:6px")}>
          <span style={css("font-size:13px;font-weight:500;color:var(--ink2)")}>Note (optional)</span>
          <textarea ref={ref} value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Next step, e.g. Follow up with recruiter on 30 Oct" className="fc-acc"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); confirm(); } }}
            style={css("resize:none;padding:8px 12px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);font-size:14px;line-height:20px")} />
          <span style={css("font-size:12px;color:var(--ink3)")}>Shown as the next step on the pipeline card.</span>
        </label>
        <div style={css("margin-top:24px;display:flex;justify-content:flex-end;gap:8px")}>
          <button onClick={() => app.setDlg(null)} className="hv-ctl press" style={css("height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);font-size:14px;font-weight:500;cursor:pointer")}>Cancel</button>
          <button onClick={confirm} className="hv-btn press" style={css("height:36px;padding:0 10px 0 14px;border:0;border-radius:10px;background:var(--btn);color:var(--btn-ink);font-size:14px;font-weight:500;display:flex;align-items:center;gap:8px;cursor:pointer")}>
            Mark as Applied<kbd style={css("height:18px;padding:0 4px;box-sizing:border-box;border-radius:4px;border:1px solid currentColor;opacity:.6;font-family:'JetBrains Mono',monospace;font-size:11px;display:inline-flex;align-items:center")}>⌘↵</kbd>
          </button>
        </div>
      </div>
    </>
  );
}

function Toast({ app }: { app: App }) {
  const t = app.toast;
  if (!t) return null;
  return (
    <div role="status" style={css(`position:fixed;z-index:60;left:50%;bottom:${app.phone ? "88px" : "32px"};transform:translateX(-50%);height:44px;display:flex;align-items:center;gap:12px;padding:0 ${t.undo ? "8px" : "16px"} 0 16px;border-radius:10px;background:var(--raised);box-shadow:var(--sh3);border:1px solid var(--line);font-size:14px;animation:jr-in 150ms ease-out;white-space:nowrap`)}>
      <span>{t.text}</span>
      {t.undo && (
        <>
          <span style={css("width:1px;height:20px;background:var(--line)")} />
          <button onClick={t.undo} className="hv-row" style={css("height:32px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--acc-ink);font-size:14px;font-weight:500;display:flex;align-items:center;gap:6px;cursor:pointer")}>
            <Icon id="undo" />Undo
          </button>
        </>
      )}
    </div>
  );
}

export function Overlays({ app }: { app: App }) {
  return (
    <>
      <FilterMenu app={app} />
      <Palette app={app} />
      <AppliedDialog app={app} />
      <Toast app={app} />
    </>
  );
}
