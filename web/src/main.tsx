// Entry: picks the screen for the current route and the desktop or phone frame around it.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { css } from "./css";
import { Sprite } from "./icons";
import { useApp, type App } from "./app";
import { DesktopShell } from "./shell";
import { InboxScreen } from "./inbox";
import { PostingDetail } from "./posting-detail";
import { PostingsScreen } from "./postings";
import { PipelineScreen } from "./pipeline";
import { CompaniesScreen, CompanyScreen } from "./companies";
import { OverviewScreen } from "./overview";
import { SourcesScreen } from "./sources";
import { SettingsScreen } from "./settings";
import { Overlays } from "./overlays";
import { PhoneShell } from "./phone";

function Screen({ app }: { app: App }) {
  const r = app.route;
  if (!app.data && r.name !== "inbox") return null;
  switch (r.name) {
    case "inbox":
      return <InboxScreen app={app} />;
    case "posting":
      return app.current ? <PostingDetail app={app} p={app.current} wide /> : <p style={css("margin:40px 32px;font-size:14px;color:var(--ink2)")}>This posting is no longer stored.</p>;
    case "postings":
      return <PostingsScreen app={app} />;
    case "pipeline":
      return <PipelineScreen app={app} />;
    case "companies":
      return <CompaniesScreen app={app} />;
    case "company":
      return <CompanyScreen app={app} companyKey={r.key} />;
    case "overview":
      return <OverviewScreen app={app} />;
    case "sources":
      return <SourcesScreen app={app} />;
    case "settings":
      return <SettingsScreen app={app} tab={r.tab} />;
  }
}

function Root() {
  const app = useApp();
  return (
    <>
      <Sprite />
      {app.loadError && !app.data ? (
        <div style={css("height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:var(--canvas)")}>
          <p style={css("margin:0;font-size:14px;color:var(--ink2)")}>Job Radar could not load its data.</p>
          <button onClick={() => void app.reload()} className="hv-ctl" style={css("height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);font-size:13px;font-weight:500;cursor:pointer")}>Try again</button>
        </div>
      ) : app.phone ? (
        <PhoneShell app={app} desktop={<Screen app={app} />} />
      ) : (
        <DesktopShell app={app}><Screen app={app} /></DesktopShell>
      )}
      <Overlays app={app} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
