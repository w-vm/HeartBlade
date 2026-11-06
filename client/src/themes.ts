import * as native from "./native";
import * as metro from "./metro";
import * as patcher from "./patcher";
import { readRegistry } from "./plugins";
import { readPrefs } from "./prefs";
import { log, warn, error } from "./log";

/**
 * Theme file format (JSON):
 * {
 *   "name": "Crimson", "author": "you", "version": "1.0.0",
 *   "semanticColors": { "BACKGROUND_PRIMARY": { "dark": "#14080a", "light": "#fff5f5" } },   // or ["#dark", "#light"], or "#both"
 *   "rawColors": { "PRIMARY_660": "#2a0d12" }
 * }
 * Colour names are Discord's own semantic / raw colour token names.
 *
 * How it works (same idea as Vendetta / Bunny): Discord's colour module (the one exporting `SemanticColor` + `RawColor`)
 * has `default.meta.resolveSemanticColor(themeName, tokenRef)`. We wrap it and answer from the theme first.
 * The token's name is stored under a Symbol key on `tokenRef`. We patch the module the moment it is initialised (before
 * Discord renders anything), because stylesheets built earlier keep the old colours.
 */
interface Theme {
  name?: string;
  /**
   * When true, any surface-like colour Discord asks for that the theme does not define (and that is a dark, near-neutral colour) is turned into black.
   * When "all", every opaque dark near-neutral colour is turned black, whatever the token is called (text, icons, borders, brand and status colours are still left alone).
   */
  autoBlack?: boolean | "all";
  /**
   * When true, every blue / purple "brand" colour Discord asks for (buttons, radios, selected tabs, links, brand text and icons) that the theme
   * does not define itself is turned neutral: white for text / icons / borders, a very dark grey for fills. Covers token names the theme does not list.
   */
  neutralBrand?: boolean;
  semanticColors?: Record<string, { dark?: string; light?: string } | string[] | string>;
  rawColors?: Record<string, string>;
}

// Newer Discord builds read BG_* tokens; older themes only define BACKGROUND_*.
const ALT: Record<string, string> = {
  BG_BACKDROP: "BACKGROUND_FLOATING",
  BG_BASE_PRIMARY: "BACKGROUND_PRIMARY",
  BG_BASE_SECONDARY: "BACKGROUND_SECONDARY",
  BG_BASE_TERTIARY: "BACKGROUND_SECONDARY_ALT",
  BG_MOD_FAINT: "BACKGROUND_MODIFIER_ACCENT",
  BG_MOD_STRONG: "BACKGROUND_MODIFIER_ACCENT",
  BG_MOD_SUBTLE: "BACKGROUND_MODIFIER_ACCENT",
  BG_SURFACE_OVERLAY: "BACKGROUND_FLOATING",
  BG_SURFACE_OVERLAY_TMP: "BACKGROUND_FLOATING",
  BG_SURFACE_RAISED: "BACKGROUND_MOBILE_PRIMARY",
};


// ---- autoBlack: catches surfaces the theme did not list by name ---------------------------------------------------
const SURFACE_RE = /BACKGROUND|BG_|SURFACE|CARD|SCRIM|BACKDROP|CHAT|INPUT|CHANNELTEXTAREA|SCROLLBAR|EMBED|SHEET|MODAL|CELL|PANEL|CONTAINER|FLOATING|OVERLAY|TOOLBAR|SETTINGS|LIST_|ROW_|MENU|POPOUT|TOOLTIP|ACTION_SHEET|FILL/;
const NOT_SURFACE_RE = /MODIFIER|BG_MOD|ACCENT|BRAND|DANGER|POSITIVE|WARNING|STATUS|LINK|MENTION|(^|_)TEXT_|ICON|BORDER|STROKE|HOVER|PLACEHOLDER|DIVIDER|SEPARATOR|OUTLINE|SHADOW|ONLINE|IDLE|DND|OFFLINE|STREAMING|SPOILER/;

function parseColor(str: string): [number, number, number, number] | null {
  const t = str.trim();
  const m = /^#([0-9a-f]{3,8})$/i.exec(t);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6) h += "ff";
    if (h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16)];
  }
  const r = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,\/]+([\d.]+))?\s*\)$/i.exec(t);
  if (r) return [+r[1], +r[2], +r[3], r[4] == null ? 255 : Math.round(parseFloat(r[4]) * 255)];
  return null;
}

/** Dark, near-neutral opaque surface colours become black (the darkest) or a very dark grey (raised surfaces). */
function autoBlackFor(name: string, orig: any, all = false): string | undefined {
  if (typeof orig !== "string" || NOT_SURFACE_RE.test(name) || (!all && !SURFACE_RE.test(name))) return undefined;
  const c = parseColor(orig);
  if (!c || c[3] < 250) return undefined;
  const [r, g, b] = c;
  if (Math.max(r, g, b) - Math.min(r, g, b) > 28) return undefined; // coloured (brand, danger...): leave alone
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (luma < 0.34) return "#000000"; // pure black: every dark grey Discord uses for a surface (cards, rows, sheets, embeds, input bars)
  return undefined;
}

const BRAND_NAME_RE = /BRAND|BLURPLE|LINK|BUTTON|CONTROL|FOCUS|SELECTED|PRIMARY|ACCENT|CTA|INDIGO|CHECKBOX|RADIO|TOGGLE|SWITCH|SLIDER|PROGRESS|TAB/;
const FOREGROUND_NAME_RE = /TEXT|ICON|LINK|FOREGROUND|BORDER|STROKE|OUTLINE|RING|FOCUS|LABEL/;

/** Blue / purple (hue 190-295, clearly saturated) "brand" colours become white (text, icons, borders) or a very dark grey (fills); alpha is kept. */
function brandNeutralFor(name: string, orig: any): string | undefined {
  if (typeof orig !== "string" || !BRAND_NAME_RE.test(name)) return undefined;
  const c = parseColor(orig);
  if (!c) return undefined;
  const [r, g, b, a] = c;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 40 || max === 0) return undefined;
  let hue: number;
  if (max === r) hue = ((g - b) / d) * 60; else if (max === g) hue = (2 + (b - r) / d) * 60; else hue = (4 + (r - g) / d) * 60;
  if (hue < 0) hue += 360;
  if (hue < 190 || hue > 295) return undefined;
  const fg = FOREGROUND_NAME_RE.test(name) || a < 250;
  const v = fg ? 255 : 26;
  return withAlpha("#" + [v, v, v].map((x) => x.toString(16).padStart(2, "0")).join(""), a / 255);
}

/** A colour the active theme defines by name (dark mode), read straight from the theme file without going through Discord's resolver. */
export function themeColor(names: string[]): string | undefined {
  try {
    const s = current?.semanticColors;
    if (!s) return undefined;
    for (const n of names) { const v = pick(s[n], false); if (v) return v; }
  } catch { /* ignore */ }
  return undefined;
}

let undo: Array<() => void> = [];
const unthemed = new Map<string, string>();   // token name -> original colour, for tokens the theme did not answer
const dumped = new Set<string>();
let autoHits = 0;
let restyled = false;
let current: Theme | null = null;
let hits = 0;
let patchedMeta = new Set<any>();

/** True while an active theme changes backgrounds / the colour palette: the HeartBlade pages then follow Discord's colours instead of plain black. */
export const themeRestylesColors = () => restyled;
const touchesBackground = (t: Theme) =>
  Object.keys(t.semanticColors ?? {}).some((k) => /^(BACKGROUND|BG_|CHAT_BACKGROUND)/.test(k)) || Object.keys(t.rawColors ?? {}).length > 0;

const isColorModule = (m: any): boolean => {
  try {
    if (!m || typeof m !== "object") return false;
    if ("SemanticColor" in m || (m.default && typeof m.default === "object" && "SemanticColor" in m.default)) return true;
    // older / simplified shape
    return !!(m.unsafe_rawColors || (m.colors && m.meta));
  } catch { return false; }
};

interface Resolved { top: any; def: any; metas: any[]; }

function resolveModule(exp: any): Resolved | null {
  if (!exp) return null;
  const def = exp.default && typeof exp.default === "object" && (exp.default.meta || exp.default.internal) ? exp.default : exp;
  const metas: any[] = [];
  for (const k of ["meta", "internal"]) {
    try { const o = def?.[k]; if (o && typeof o.resolveSemanticColor === "function" && !metas.includes(o)) metas.push(o); } catch { /* ignore */ }
  }
  if (!metas.length) return null;
  return { top: exp, def, metas };
}

/** hex (#rgb / #rrggbb / #rrggbbaa) + alpha -> #rrggbbaa */
function withAlpha(hex: string, a: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return hex;
  const al = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
  return "#" + h.slice(0, 6) + al;
}

function pick(o: any, light: boolean): string | undefined {
  if (o == null) return undefined;
  if (typeof o === "string") return o;
  if (Array.isArray(o)) return (light ? o[1] : o[0]) || undefined;
  if (typeof o === "object") return (light ? o.light : o.dark) || undefined;
  return undefined;
}

export function removeTheme() {
  restyled = false;
  current = null;
  while (undo.length) { try { undo.pop()!(); } catch { /* ignore */ } }
  patchedMeta = new Set();
}

export function applyTheme(theme: Theme, exportsHint?: any) {
  removeTheme();
  restyled = touchesBackground(theme);
  current = theme;
  hits = 0; autoHits = 0; unthemed.clear(); dumped.clear();

  const exp = exportsHint ?? metro.find(isColorModule);
  const mod = resolveModule(exp);
  if (!mod) { warn("theme: Discord's colour module was not found, nothing applied"); return; }
  const { top, def, metas } = mod;

  // Token objects -> names. Discord keeps the name under a Symbol key; the identity map is a fallback for simplified builds.
  const byIdentity = new Map<any, string>();
  try { const tokens = def.colors ?? top.colors; if (tokens) for (const k of Object.keys(tokens)) { try { byIdentity.set(tokens[k], k); } catch { /* ignore */ } } } catch { /* ignore */ }
  const nameOf = (ref: any): string | undefined => {
    try {
      if (ref != null) {
        const o = Object(ref);
        for (const s of Object.getOwnPropertySymbols(o)) { const v = o[s]; if (typeof v === "string") return v; }
      }
    } catch { /* fall through */ }
    return byIdentity.get(ref);
  };

  const raw = theme.rawColors ?? {};

  // 1) Raw palette: direct readers of RawColor / unsafe_rawColors see the theme's values.
  const rawHolders: any[] = [];
  try { if (top.RawColor && typeof top.RawColor === "object") rawHolders.push(top.RawColor); } catch { /* ignore */ }
  try { if (def.unsafe_rawColors && typeof def.unsafe_rawColors === "object" && !rawHolders.includes(def.unsafe_rawColors)) rawHolders.push(def.unsafe_rawColors); } catch { /* ignore */ }
  for (const holder of rawHolders) {
    for (const k of Object.keys(raw)) {
      let desc: PropertyDescriptor | undefined;
      try { desc = Object.getOwnPropertyDescriptor(holder, k); } catch { /* ignore */ }
      try {
        Object.defineProperty(holder, k, { configurable: true, enumerable: true, get: () => (current?.rawColors?.[k] ?? (desc && "value" in desc ? desc.value : desc?.get?.call(holder))) });
        undo.push(() => { try { if (desc) Object.defineProperty(holder, k, desc); else delete holder[k]; } catch { /* ignore */ } });
      } catch { warn(`raw colour ${k} is read-only`); }
    }
  }

  // 2) Semantic colours: answer from the theme, then from the theme's raw palette, then fall through to Discord.
  const resolve = (args: any[], ret: any) => {
    const t = current;
    if (!t) return;
    const mode = String(args[0] ?? "dark").toLowerCase();
    const light = mode === "light";
    const name = nameOf(args[1]);
    if (!name) return;
    const s = t.semanticColors ?? {};
    const v = pick(s[name] ?? (ALT[name] ? s[ALT[name]] : undefined), light);
    if (v) { hits++; return v; }
    const r = t.rawColors;
    if (r) {
      let def2: any;
      try { def2 = top.SemanticColor?.[name]?.[mode]; } catch { /* ignore */ }
      const rv = def2?.raw ? r[def2.raw] : undefined;
      if (rv) { hits++; return typeof def2.opacity === "number" && def2.opacity !== 1 ? withAlpha(rv, def2.opacity) : rv; }
    }
    if (t.autoBlack) { const ab = autoBlackFor(name, ret, t.autoBlack === "all"); if (ab) { hits++; autoHits++; return ab; } }
    if (t.neutralBrand) { const nb = brandNeutralFor(name, ret); if (nb) { hits++; autoHits++; return nb; } }
    if (typeof ret === "string" && unthemed.size < 600) unthemed.set(name, ret);
  };
  for (const meta of metas) {
    if (patchedMeta.has(meta)) continue;
    patchedMeta.add(meta);
    try { undo.push(patcher.after(meta, "resolveSemanticColor", resolve)); } catch (e) { warn("theme: cannot patch resolveSemanticColor", (e as any)?.message ?? e); }
  }

  log(`theme applied: ${theme.name ?? "unnamed"} (patched ${metas.length} resolver, ${Object.keys(theme.semanticColors ?? {}).length} semantic, ${Object.keys(raw).length} raw, tokens by ${byIdentity.size ? "symbol+identity" : "symbol"})`);
  if (typeof setTimeout === "function") {
    setTimeout(() => { if (current === theme) { if (hits) log(`theme: ${hits} colours served from "${theme.name ?? "theme"}"${autoHits ? ` (${autoHits} by autoBlack)` : ""}`); else warn(`theme: no colour was served yet from "${theme.name ?? "theme"}" (token names did not match Discord's?)`); dumpUnthemed(); } }, 6000);
    setTimeout(() => { if (current === theme) dumpUnthemed(); }, 30000);
  }
}

/** Logs the colour tokens Discord asked for that the theme did not answer (name=original colour), so they can be added to the theme. */
function dumpUnthemed() {
  const fresh = [...unthemed.entries()].filter(([k]) => !dumped.has(k));
  if (!fresh.length) return;
  fresh.forEach(([k]) => dumped.add(k));
  log(`theme: ${fresh.length} tokens not themed:`);
  let line = "";
  for (const [k, v] of fresh) {
    const part = `${k}=${v}`;
    if (line.length + part.length > 700) { log(line); line = ""; }
    line += (line ? " " : "") + part;
  }
  if (line) log(line);
}

let startedFor: string | null = null;
let earlyDone = false;

/** Reads the enabled theme from disk and applies it. `exportsHint` is the colour module when called from the early hook. */
export function startEnabledTheme(exportsHint?: any) {
  try { if (readPrefs().safeMode) return; } catch { /* ignore */ }
  const entry = readRegistry().find((e) => e.type === "theme" && e.enabled);
  if (!entry) return;
  if (!exportsHint && startedFor === entry.id && current) return; // already applied by the early hook
  const theme = native.readJSON<Theme | null>(`themes/${entry.id}.json`, null);
  if (!theme) { error(`theme ${entry.id}: file missing`); return; }
  try { applyTheme(theme, exportsHint); startedFor = entry.id; } catch (e) { error("theme failed", e); }
}

/** Called by the metro hook for every module right after it initialises: patches Discord's colour module before anything renders. */
export function maybeEarlyTheme(exp: any) {
  if (earlyDone || !isColorModule(exp) || !resolveModule(exp)) return;
  earlyDone = true;
  startEnabledTheme(exp);
}
