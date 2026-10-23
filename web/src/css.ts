// Inline styles are written as CSS text, the way the Claude Design export writes them, and turned into React
// style objects once per distinct string. This keeps every value one-to-one with the export.
import type { CSSProperties } from "react";

const cache = new Map<string, CSSProperties>();

export function css(text: string): CSSProperties {
  const hit = cache.get(text);
  if (hit) return hit;
  const out: Record<string, string> = {};
  for (const decl of text.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    out[prop.startsWith("--") ? prop : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  cache.set(text, out as CSSProperties);
  return out as CSSProperties;
}
