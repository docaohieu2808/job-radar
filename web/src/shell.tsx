// The app frame from the export: sidebar on the canvas, a top bar, and one raised sheet for the screen.
import type { ReactNode } from "react";
import { css } from "./css";
import { Icon } from "./icons";
import type { App, Route } from "./app";
import { clock } from "./model";

const NAV: [string, string, string, Route["name"]][] = [
  ["Inbox", "#/inbox", "inbox", "inbox"],
  ["All postings", "#/postings", "list", "postings"],
  ["Pipeline", "#/pipeline", "pipe", "pipeline"],
  ["Companies", "#/companies", "co", "companies"],
  ["Overview", "#/overview", "chart", "overview"],
  ["Sources", "#/sources", "src", "sources"],
  ["Settings", "#/settings/scoring", "set", "settings"],
];

const KBD = "min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:4px;border:1px solid var(--line2);background:var(--sunk);font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ink3);display:inline-flex;align-items:center;justify-content:center";
export const kbd = css(KBD);

function Sidebar({ app }: { app: App }) {
  const { route, prev, compact, inbox, data, theme } = app;
  const labelDisp = compact ? "none" : "inline";
  const unhealthy = data?.sources.find((s) => s.status !== "Healthy");
  const last = data?.usage.lastChecked;
  return (
    <aside style={css(`width:${compact ? "64px" : "232px"};flex:none;display:flex;flex-direction:column;padding:0 12px 16px;box-sizing:border-box`)}>
      <div style={css("height:48px;display:flex;align-items:center;gap:8px;padding:0 4px;font-size:16px;font-weight:600;letter-spacing:-0.01em;color:var(--ink);white-space:nowrap;overflow:hidden")}>
        <Icon id="logo" size={24} style={css("flex:none")} />
        <span style={css(`display:${labelDisp}`)}>Job Radar</span>
      </div>
      <nav style={css("display:flex;flex-direction:column;gap:2px;margin-top:4px")}>
        {NAV.map(([label, href, sym, key]) => {
          const on = route.name === key || (key === "companies" && route.name === "company") || (key === "inbox" && route.name === "posting" && prev?.name === "inbox");
          const showCount = key === "inbox" && inbox.length > 0 && !compact;
          return (
            <a key={key} href={href} aria-current={on ? "page" : undefined} title={label} className="hv-nav"
              style={css(`position:relative;height:28px;display:flex;align-items:center;gap:8px;padding:0 8px;border-radius:6px;font-size:13px;font-weight:500;color:${on ? "var(--ink)" : "var(--ink2)"};background:${on ? "var(--navsel)" : "transparent"};box-shadow:${on ? "var(--sh1)" : "none"};text-decoration:none;transition:background 150ms ease-out, color 150ms ease-out`)}>
              <span style={css(`position:absolute;left:-12px;top:6px;bottom:6px;width:2px;border-radius:9999px;background:var(--accent);opacity:${on ? 1 : 0}`)} />
              <Icon id={sym} style={css(`color:${on ? "var(--accent)" : "var(--ink3)"};flex:none`)} />
              <span style={css(`flex:1;display:${labelDisp};white-space:nowrap`)}>{label}</span>
              {showCount && (
                <span style={css("min-width:20px;height:18px;padding:0 6px;box-sizing:border-box;border-radius:9999px;background:var(--sheet);box-shadow:inset 0 0 0 1px var(--line);font-size:11px;font-weight:600;color:var(--ink);display:inline-flex;align-items:center;justify-content:center")}>{inbox.length}</span>
              )}
            </a>
          );
        })}
      </nav>
      <div style={css("flex:1")} />
      <div style={css("display:flex;flex-direction:column;gap:12px;padding:0 8px")}>
        {!compact && (last || unhealthy) && (
          <a href="#/sources" style={css("display:flex;flex-direction:column;gap:4px;text-decoration:none")}>
            {last && <span style={css("font-size:12px;color:var(--ink3)")}>Last checked {clock(last)}</span>}
            {unhealthy && (
              <span style={css(`display:flex;align-items:center;gap:6px;font-size:12px;color:${unhealthy.status === "Blocked" ? "var(--bad)" : "var(--warn)"}`)}>
                <span style={css(`width:6px;height:6px;border-radius:9999px;background:${unhealthy.status === "Blocked" ? "var(--bad)" : "var(--warn)"}`)} />
                {unhealthy.name} {unhealthy.status === "Blocked" ? "paused" : "degraded"}
              </span>
            )}
          </a>
        )}
        <div style={css("display:flex;gap:4px;margin:0 -8px")}>
          <button onClick={() => app.setTheme(theme === "dark" ? "light" : "dark")} title={theme === "dark" ? "Light theme" : "Dark theme"} className="hv-nav press"
            style={css("height:32px;padding:0 8px;border:0;border-radius:10px;background:transparent;color:var(--ink2);font-size:13px;display:flex;align-items:center;gap:8px;cursor:pointer;white-space:nowrap;transition:background 150ms ease-out")}>
            <Icon id="moon" style={css("flex:none")} />
            <span style={css(`display:${labelDisp}`)}>{theme === "dark" ? "Light theme" : "Dark theme"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

const BACK: Partial<Record<Route["name"], [string, string]>> = {
  inbox: ["Back to Inbox", "#/inbox"],
  postings: ["Back to All postings", "#/postings"],
  pipeline: ["Back to Pipeline", "#/pipeline"],
  companies: ["Back to Companies", "#/companies"],
  overview: ["Back to Overview", "#/overview"],
};

function Header({ app }: { app: App }) {
  const { route, prev } = app;
  let back: [string, string] | null = null;
  if (route.name === "company") back = ["Back to Companies", "#/companies"];
  if (route.name === "posting") {
    if (prev?.name === "company") back = ["Back to company", `#/companies/${encodeURIComponent(prev.key)}`];
    else back = (prev && BACK[prev.name]) || BACK.inbox!;
  }
  return (
    <header style={css("height:48px;flex:none;display:flex;align-items:center;gap:16px;padding-right:24px;min-width:0")}>
      {back && (
        <a href={back[1]} className="hv-ink" style={css("display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--ink2);text-decoration:none")}>
          <Icon id="back" />
          {back[0]}
        </a>
      )}
      <button onClick={app.openSearch} className="hv-ctl"
        style={css("width:320px;min-width:0;flex:0 1 320px;overflow:hidden;white-space:nowrap;height:32px;display:flex;align-items:center;gap:8px;padding:0 6px 0 10px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);color:var(--ink3);font-size:13px;cursor:text;transition:border-color 150ms ease-out")}>
        <Icon id="search" />
        <span style={css("flex:1;text-align:left")}>Search postings and companies</span>
        <kbd style={kbd}>/</kbd>
      </button>
      <div style={css("flex:1")} />
      <button onClick={() => app.setPal(true)} className="hv-nav press"
        style={css("height:32px;flex:none;white-space:nowrap;display:flex;align-items:center;gap:8px;padding:0 6px 0 10px;border:0;border-radius:10px;background:transparent;color:var(--ink2);font-size:13px;cursor:pointer;transition:background 150ms ease-out")}>
        Commands<kbd style={kbd}>⌘K</kbd>
      </button>
    </header>
  );
}

export function DesktopShell({ app, children }: { app: App; children: ReactNode }) {
  return (
    <div style={css("height:100vh;min-height:640px;min-width:0;display:flex;font-family:Inter,system-ui,sans-serif;font-size:14px;color:var(--ink);background:radial-gradient(1400px 900px at 0% 0%, var(--wash), transparent 62%), var(--canvas);overflow:hidden;position:relative")}>
      <Sidebar app={app} />
      <div style={css("flex:1;min-width:0;display:flex;flex-direction:column")}>
        <Header app={app} />
        <main style={css("flex:1;min-height:0;margin:0 24px 24px 0;background:var(--sheet);border-radius:16px;box-shadow:var(--sh1);display:flex;flex-direction:column;overflow:hidden;position:relative")}>
          {children}
        </main>
      </div>
    </div>
  );
}
