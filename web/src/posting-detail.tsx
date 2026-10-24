// The open posting (Inbox detail pane and screen 03 Posting page): key facts, stack fit, why this score,
// the original description and the company's other postings.
import { useEffect, useState } from "react";
import { css } from "./css";
import { Icon } from "./icons";
import { kbd } from "./shell";
import type { App } from "./app";
import { api, type DescriptionView, type PostingView } from "./api";
import { VietnameseSection } from "./vietnamese";
import { ENGLISH_LABEL, LEVEL_LABEL, MODE_LABEL, breakdown, dayMonth, postedIso, salaryText, scoreColor, sourceText, tile, initial, isOpen } from "./model";

const descriptionCache = new Map<number, DescriptionView>();

// The posting's text and its Vietnamese; `update` stores a fresh copy after a translation.
export function useDescription(id: number): [DescriptionView | null, (d: DescriptionView) => void] {
  const [d, setD] = useState(descriptionCache.get(id) ?? null);
  useEffect(() => {
    let live = true;
    const hit = descriptionCache.get(id);
    setD(hit ?? null);
    if (!hit)
      api.description(id).then((r) => {
        descriptionCache.set(id, r);
        if (live) setD(r);
      }, () => undefined);
    return () => {
      live = false;
    };
  }, [id]);
  const update = (next: DescriptionView) => {
    descriptionCache.set(id, next);
    setD(next);
  };
  return [d, update];
}

export type Fact = { i: string; t: string; s?: string; w: number };

// Excerpts stored before bullets were stripped still start with "- ".
const clean = (s?: string) => s?.replace(/^[-•*]\s*/, "");

const HIDES_SALARY = new Set(["ITviec", "TopDev"]);

export function facts(p: PostingView): Fact[] {
  const out: Fact[] = [];
  const salary = salaryText(p);
  if (salary) out.push({ i: "cash", t: salary, s: p.excerpts.salary && p.excerpts.salary !== salary ? p.excerpts.salary : undefined, w: 500 });
  else {
    const hider = p.sources.find((s) => HIDES_SALARY.has(s.name));
    out.push({ i: "cash", t: "Salary not shown", s: hider ? `${hider.name} hides salary without sign-in` : undefined, w: 400 });
  }
  if (p.years !== null) out.push({ i: "level", t: `${p.years}+ years' experience`, s: LEVEL_LABEL[p.level], w: 500 });
  else if (LEVEL_LABEL[p.level]) out.push({ i: "level", t: LEVEL_LABEL[p.level], w: 500 });
  out.push({ i: "pin", t: [MODE_LABEL[p.workMode], p.location].filter(Boolean).join(" · ") || "Place not stated", w: 500 });
  if (ENGLISH_LABEL[p.english]) out.push({ i: "globe", t: ENGLISH_LABEL[p.english], s: clean(p.excerpts.english), w: 500 });
  return out;
}

export function benefits(p: PostingView): string[] {
  return [p.certSupport ? clean(p.excerpts.certSupport) : undefined, clean(p.excerpts.abroad)].filter((x): x is string => Boolean(x));
}

// Splits the description so each matched skill can be emphasised, as the export does.
export function segments(text: string, terms: string[]): { t: string; hit: boolean }[] {
  if (!terms.length) return [{ t: text, hit: false }];
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|")})`, "g");
  return text.split(re).filter(Boolean).map((t) => ({ t, hit: terms.includes(t) }));
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function ActionButtons({ app, p }: { app: App; p: PostingView }) {
  return (
    <>
      <button onClick={() => app.openApplied(p.id)} className="hv-btn press"
        style={css("height:36px;padding:0 10px 0 14px;border:0;border-radius:10px;background:var(--btn);color:var(--btn-ink);font-size:14px;font-weight:500;display:flex;align-items:center;gap:8px;cursor:pointer;transition:background 150ms ease-out, transform 100ms ease-out")}>
        <Icon id="send" />Applied<kbd style={css("min-width:18px;height:18px;box-sizing:border-box;border-radius:4px;border:1px solid currentColor;opacity:.6;font-family:'JetBrains Mono',monospace;font-size:11px;display:inline-flex;align-items:center;justify-content:center")}>a</kbd>
      </button>
      <button onClick={() => app.act("interested", p.id)} className="hv-ctl press"
        style={css("height:36px;padding:0 10px 0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);color:var(--ink);font-size:14px;font-weight:500;display:flex;align-items:center;gap:8px;cursor:pointer;transition:border-color 150ms ease-out, transform 100ms ease-out")}>
        <Icon id="mark" />Interested<kbd style={kbd}>i</kbd>
      </button>
      <button onClick={() => app.act("skipped", p.id)} className="hv-ctl press"
        style={css("height:36px;padding:0 10px 0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);color:var(--ink);font-size:14px;font-weight:500;display:flex;align-items:center;gap:8px;cursor:pointer;transition:border-color 150ms ease-out, transform 100ms ease-out")}>
        <Icon id="x" />Skip<kbd style={kbd}>s</kbd>
      </button>
    </>
  );
}

export function PostingDetail({ app, p, wide }: { app: App; p: PostingView; wide: boolean }) {
  const [desc, setDesc] = useDescription(p.id);
  const prefs = app.prefs!;
  const t = tile(p.companyKey);
  const fs = facts(p);
  const bs = benefits(p);
  const why = breakdown(p, prefs.weights);
  const max = Math.max(...why.slice(1).map((r) => Math.abs(r.w)), 1);
  const companyHref = `#/companies/${encodeURIComponent(p.companyKey)}`;
  const siblings = (app.data?.postings ?? []).filter((x) => x.companyKey === p.companyKey && x.id !== p.id);
  const otherOpen = siblings.filter(isOpen);
  const past = siblings.filter((x) => !isOpen(x));
  const first = p.sources[0];
  const seenLine = p.repostedAt
    ? `First seen ${dayMonth(p.firstSeen)} · Reposted ${dayMonth(p.repostedAt)}`
    : `${sourceText(p)} · Seen ${dayMonth(p.firstSeen)}`;
  const emails = desc ? [...new Set(desc.description.match(EMAIL) ?? [])].slice(0, 3) : [];
  return (
    <article style={css("flex:1;min-width:0;overflow-y:auto;position:relative")}>
      <div style={css(`max-width:${wide ? "880px" : "none"};margin:0 auto;padding:0 20px 48px`)}>
        <div style={css("position:sticky;top:0;z-index:3;padding-top:40px;background:var(--sheet)")}>
          <div style={css("position:relative;background:var(--raised);border-radius:16px;box-shadow:var(--sh2);padding:36px 24px 20px")}>
            <div style={{ ...css("position:absolute;left:24px;top:-24px;width:48px;height:48px;border-radius:10px;font-size:20px;font-weight:600;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 4px var(--sheet), var(--sh1)"), background: t.tileBg, color: t.tileInk }}>{initial(p.company)}</div>
            <div style={css("position:absolute;right:24px;top:16px;display:flex;flex-direction:column;align-items:flex-end")}>
              <span style={css(`font-size:24px;font-weight:600;line-height:32px;color:${scoreColor(p.score, prefs)}`)}>{p.score}</span>
              <span style={css("font-size:12px;color:var(--ink3)")}>match</span>
            </div>
            <div style={css("padding-right:72px")}>
              <h2 style={css("margin:0;font-size:20px;font-weight:600;letter-spacing:-0.01em;line-height:28px;text-wrap:pretty")}>{p.title}</h2>
              <div style={css("margin-top:4px;font-size:13px;color:var(--ink2);display:flex;gap:8px;flex-wrap:wrap")}>
                <a href={companyHref} style={css("color:var(--ink);font-weight:500")}>{p.company}</a>
                <span style={css("color:var(--ink3)")}>{seenLine}</span>
              </div>
            </div>
            <div style={css("margin-top:20px;display:flex;flex-wrap:wrap;align-items:center;gap:8px")}>
              <ActionButtons app={app} p={p} />
              <div style={css("flex:1")} />
              {first && (
                <a href={first.url} target="_blank" rel="noopener" style={css("height:32px;padding:0 8px;border-radius:10px;font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;white-space:nowrap;flex:none")}>
                  Open on {first.name}<Icon id="ext" /><kbd style={kbd}>o</kbd>
                </a>
              )}
            </div>
          </div>
          <div style={css("height:12px;background:linear-gradient(var(--sheet),transparent)")} />
        </div>

        <div style={css("padding:0 4px;display:flex;flex-direction:column;gap:32px")}>
          {p.closedAt && (
            <p style={css("margin:4px 0 -8px;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2)")}>
              <Icon id="alert" style={css("color:var(--warn);flex:none")} />Closed at source on {dayMonth(p.closedAt)}. Actions still work.
            </p>
          )}

          <section>
            <h3 style={css("margin:0;font-size:14px;font-weight:600")}>Key facts</h3>
            <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>Extracted automatically from the posting.</p>
            <div style={css("margin-top:12px;display:flex;flex-direction:column")}>
              {fs.map((f, i) => (
                <div key={i} style={css("display:grid;grid-template-columns:16px minmax(0,1fr);column-gap:12px;padding:8px 0;border-bottom:1px solid var(--line)")}>
                  <Icon id={f.i} style={css("color:var(--ink3);margin-top:2px")} />
                  <div>
                    <div style={css(`font-size:14px;color:var(--ink);font-weight:${f.w}`)}>{f.t}</div>
                    {f.s && <div style={css("font-size:13px;color:var(--ink2);margin-top:2px")}>{f.s}</div>}
                  </div>
                </div>
              ))}
            </div>
            {bs.length > 0 && (
              <>
                <h4 style={css("margin:20px 0 4px;font-size:13px;font-weight:600;color:var(--ink2)")}>Notable benefits</h4>
                {bs.map((b, i) => (
                  <div key={i} style={css("display:grid;grid-template-columns:16px minmax(0,1fr);column-gap:12px;padding:6px 0;font-size:14px;color:var(--ink)")}>
                    <Icon id="award" style={css("color:var(--ink3);margin-top:2px")} /><span>{b}</span>
                  </div>
                ))}
              </>
            )}
          </section>

          {p.have.length + p.gap.length > 0 && (
            <section>
              <h3 style={css("margin:0;font-size:14px;font-weight:600")}>Stack fit</h3>
              <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>{`${p.have.length} of ${p.have.length + p.gap.length} skills named in the posting are in the current stack.`}</p>
              {p.have.length > 0 && (
                <>
                  <div style={css("margin-top:12px;font-size:12px;font-weight:500;color:var(--ink3)")}>You have</div>
                  <div className="no-scrollbar" style={css("margin:8px -24px 0 0;display:flex;gap:8px;overflow-x:auto;padding-right:24px")}>
                    {p.have.map((c) => (
                      <span key={c} style={css("height:28px;flex:none;padding:0 10px;border-radius:6px;background:var(--sunk);box-shadow:inset 0 0 0 1px var(--line);font-size:13px;color:var(--ink);display:inline-flex;align-items:center;gap:6px")}>
                        <Icon id="check" style={css("color:var(--ok)")} />{c}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {p.gap.length > 0 && (
                <>
                  <div style={css("margin-top:12px;font-size:12px;font-weight:500;color:var(--ink3)")}>Gap</div>
                  <div style={css("margin-top:8px;display:flex;gap:8px;flex-wrap:wrap")}>
                    {p.gap.map((c) => (
                      <span key={c} style={css("height:28px;padding:0 10px;border-radius:6px;background:var(--warn-bg);font-size:13px;color:var(--warn);display:inline-flex;align-items:center")}>{c}</span>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          <section>
            <h3 style={css("margin:0;font-size:14px;font-weight:600")}>Why this score</h3>
            <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>Each factor with its weight. Weights are set in Settings › Scoring.</p>
            <div style={css("margin-top:12px")}>
              {why.map((w, i) => (
                <div key={i} style={css("display:grid;grid-template-columns:minmax(0,1fr) 120px 40px;column-gap:16px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)")}>
                  <div style={css("min-width:0")}>
                    <span style={css("font-size:14px;color:var(--ink)")}>{w.label}</span>
                    <span style={css("font-size:13px;color:var(--ink3)")}> · {w.note}</span>
                  </div>
                  <div style={css("height:4px;border-radius:9999px;background:var(--sunk);overflow:hidden")}>
                    {i > 0 && <div style={css(`height:4px;width:${(Math.abs(w.w) / max) * 100}%;background:${w.w < 0 ? "var(--warn)" : "var(--c1)"};border-radius:9999px`)} />}
                  </div>
                  <span style={css(`text-align:right;font-size:14px;font-weight:500;color:${w.w < 0 ? "var(--warn)" : w.w === 0 ? "var(--ink3)" : "var(--ink)"}`)}>{(w.w > 0 ? "+" : w.w < 0 ? "−" : "") + Math.abs(w.w)}</span>
                </div>
              ))}
              <div style={css("display:flex;justify-content:space-between;padding:10px 0 0;font-size:14px;font-weight:600")}>
                <span>Match</span><span style={css(`color:${scoreColor(p.score, prefs)}`)}>{p.score}</span>
              </div>
            </div>
          </section>

          {desc && <VietnameseSection id={p.id} desc={desc} onUpdate={setDesc} />}

          <section>
            <h3 style={css("margin:0;font-size:14px;font-weight:600")}>Original description</h3>
            <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>{desc ? "Verbatim, as published. Matched skills are emphasised." : "Loading the description…"}</p>
            {desc && (
              <>
                <p lang="vi" style={css("margin:12px 0 0;font-size:14px;line-height:22px;color:var(--ink);text-wrap:pretty;max-width:640px;white-space:pre-line")}>
                  {segments(desc.description, desc.terms).map((g, i) => (
                    <span key={i} style={css(`font-weight:${g.hit ? 600 : 400};background:${g.hit ? "var(--sunk)" : "transparent"};border-radius:4px;padding:${g.hit ? "1px 3px" : "0"}`)}>{g.t}</span>
                  ))}
                </p>
                {emails.length > 0 && (
                  <p style={css("margin:12px 0 0;font-size:13px;color:var(--ink2)")}>
                    Contact {emails.map((e, i) => <span key={e}>{i > 0 && ", "}<a href={`mailto:${e}`}>{e}</a></span>)}
                  </p>
                )}
              </>
            )}
          </section>

          <section>
            <div style={css("display:flex;align-items:center;gap:8px")}>
              <h3 style={css("margin:0;font-size:14px;font-weight:600;flex:1")}>{p.company}</h3>
              <a href={companyHref} style={css("font-size:13px;font-weight:500")}>Company page</a>
            </div>
            <div style={css("margin-top:12px;font-size:12px;font-weight:500;color:var(--ink3)")}>Other open postings</div>
            {otherOpen.length === 0 ? (
              <p style={css("margin:6px 0 0;font-size:13px;color:var(--ink2)")}>None at the moment.</p>
            ) : (
              otherOpen.map((x) => (
                <a key={x.id} href={`#/jobs/${x.id}`} className="hv-row" style={css("display:grid;grid-template-columns:40px minmax(0,1fr) auto;column-gap:12px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px;color:var(--ink);text-decoration:none")}>
                  <span style={css(`font-weight:600;color:${scoreColor(x.score, prefs)}`)}>{x.score}</span><span>{x.title}</span><span style={css("font-weight:500")}>{salaryText(x) ?? "Salary not shown"}</span>
                </a>
              ))
            )}
            {past.length > 0 && (
              <>
                <div style={css("margin-top:16px;font-size:12px;font-weight:500;color:var(--ink3)")}>Past postings</div>
                {past.map((x) => (
                  <div key={x.id} style={css("display:grid;grid-template-columns:72px minmax(0,1fr) auto;column-gap:12px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px")}>
                    <span style={css("color:var(--ink3)")}>{dayMonth(postedIso(x))}</span>
                    <span style={css("color:var(--ink)")}>{x.title} · {sourceText(x)}</span>
                    <span style={css("font-weight:500")}>{salaryText(x) ?? "Salary not shown"}</span>
                  </div>
                ))}
              </>
            )}
          </section>

          <section>
            <h3 style={css("margin:0;font-size:14px;font-weight:600")}>Sources</h3>
            <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>{p.sources.length > 1 ? `Merged from ${p.sources.length} sources.` : "Found on one source."}</p>
            <div style={css("margin-top:8px")}>
              {p.sources.map((s) => (
                <div key={s.url} style={css("display:flex;align-items:center;gap:12px;height:40px;border-bottom:1px solid var(--line);font-size:13px")}>
                  <span style={css("width:120px;font-weight:500;color:var(--ink)")}>{s.name}</span>
                  <span style={css("flex:1;color:var(--ink3)")}>First seen {dayMonth(s.firstSeen)} · last seen {dayMonth(s.lastSeen)}</span>
                  <a href={s.url} target="_blank" rel="noopener" style={css("display:flex;align-items:center;gap:4px;font-weight:500")}>Open<Icon id="ext" /></a>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}
