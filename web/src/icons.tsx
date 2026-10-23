// The export's inline SVG sprite (one 1.5px stroke family), rendered once at the root.
import type { CSSProperties } from "react";

const SPRITE = `<symbol id="i-logo" viewBox="0 0 32 32"><rect width="32" height="32" rx="10" style="fill:var(--btn)"></rect><circle cx="16" cy="16" r="10" fill="none" stroke-width="1.5" style="stroke:var(--btn-ink);stroke-opacity:.35"></circle><circle cx="16" cy="16" r="5.5" fill="none" stroke-width="1.5" style="stroke:var(--btn-ink);stroke-opacity:.6"></circle><path d="M16 16L23.1 8.9" stroke-width="1.5" stroke-linecap="round" style="stroke:var(--btn-ink)"></path><circle cx="16" cy="16" r="1.5" style="fill:var(--btn-ink)"></circle><circle cx="21.5" cy="10.5" r="2.25" style="fill:var(--accent)"></circle></symbol>
<symbol id="i-inbox" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9h3.5l1 2h3l1-2H14"></path><path d="M2 9l1.7-5.1A1.3 1.3 0 0 1 4.9 3h6.2a1.3 1.3 0 0 1 1.2.9L14 9v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"></path></symbol>
<symbol id="i-list" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4h8M6 8h8M6 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01"></path></symbol>
<symbol id="i-pipe" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="2.5" width="3" height="11" rx="1"></rect><rect x="6.5" y="2.5" width="3" height="7" rx="1"></rect><rect x="11" y="2.5" width="3" height="4.5" rx="1"></rect></symbol>
<symbol id="i-co" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14V3h6.5v11M9.5 6.5H13V14M2 14h12M5.5 5.5h1.5M5.5 8h1.5M5.5 10.5h1.5"></path></symbol>
<symbol id="i-chart" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 2.5v11h11M5.5 10l2.5-3 2 2 3.5-4.5"></path></symbol>
<symbol id="i-src" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="1.5"></circle><path d="M5 11a4.2 4.2 0 0 1 0-6M11 5a4.2 4.2 0 0 1 0 6M3 13a7 7 0 0 1 0-10M13 3a7 7 0 0 1 0 10"></path></symbol>
<symbol id="i-set" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h7M12 4h2M2 8h2M7 8h7M2 12h8M13 12h1"></path><circle cx="10.5" cy="4" r="1.5"></circle><circle cx="5.5" cy="8" r="1.5"></circle><circle cx="11.5" cy="12" r="1.5"></circle></symbol>
<symbol id="i-search" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"></circle><path d="M10.5 10.5L14 14"></path></symbol>
<symbol id="i-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7"></path></symbol>
<symbol id="i-x" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"></path></symbol>
<symbol id="i-mark" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 2.5h8v11l-4-3-4 3z"></path></symbol>
<symbol id="i-send" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M14 2L7 9M14 2l-4.5 12L7 9 2 6.5z"></path></symbol>
<symbol id="i-ext" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M13.5 2.5L8 8M12 9.5v4H2.5V4h4"></path></symbol>
<symbol id="i-back" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8H3M7 4L3 8l4 4"></path></symbol>
<symbol id="i-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5L10.5 8 6 12.5"></path></symbol>
<symbol id="i-down" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"></path></symbol>
<symbol id="i-moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"></path></symbol>
<symbol id="i-out" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.5h3v11h-3M7 5L4 8l3 3M4 8h7.5"></path></symbol>
<symbol id="i-plus" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"></path></symbol>
<symbol id="i-cash" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="1.5" y="4" width="13" height="8" rx="1.5"></rect><circle cx="8" cy="8" r="1.8"></circle></symbol>
<symbol id="i-level" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="5" width="12" height="8.5" rx="1.5"></rect><path d="M6 5V3.5h4V5"></path></symbol>
<symbol id="i-pin" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 14.5s4.5-4 4.5-8a4.5 4.5 0 0 0-9 0c0 4 4.5 8 4.5 8z"></path><circle cx="8" cy="6.5" r="1.5"></circle></symbol>
<symbol id="i-globe" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"></circle><path d="M2 8h12M8 2c2.2 2.2 2.2 9.8 0 12M8 2c-2.2 2.2-2.2 9.8 0 12"></path></symbol>
<symbol id="i-award" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><circle cx="8" cy="6" r="3.5"></circle><path d="M5.8 8.8L5 14l3-1.5 3 1.5-.8-5.2"></path></symbol>
<symbol id="i-alert" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"></circle><path d="M8 5v3.5M8 11h.01"></path></symbol>
<symbol id="i-undo" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3L2 6l3 3M2 6h7.5a4 4 0 0 1 0 8H7"></path></symbol>
<symbol id="i-grip" viewBox="0 0 16 16" fill="currentColor"><circle cx="6" cy="4" r="1"></circle><circle cx="10" cy="4" r="1"></circle><circle cx="6" cy="8" r="1"></circle><circle cx="10" cy="8" r="1"></circle><circle cx="6" cy="12" r="1"></circle><circle cx="10" cy="12" r="1"></circle></symbol>
<symbol id="i-star" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z"></path></symbol>
<symbol id="i-starf" viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z"></path></symbol>
<symbol id="i-cmd" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M6 6V4.5A1.5 1.5 0 1 0 4.5 6H6zm0 0h4M6 6v4m4-4V4.5A1.5 1.5 0 1 1 11.5 6H10zm0 0v4m0 0h1.5a1.5 1.5 0 1 1-1.5 1.5V10zm0 0H6m0 0v1.5A1.5 1.5 0 1 1 4.5 10H6z"></path></symbol>
<symbol id="i-backchev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5L5.5 8l4.5 4.5"></path></symbol>`;

export function Sprite() {
  return <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: `<defs>${SPRITE}</defs>` }} />;
}

export function Icon({ id, size = 16, style }: { id: string; size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} style={style} aria-hidden="true">
      <use href={`#i-${id}`} />
    </svg>
  );
}
