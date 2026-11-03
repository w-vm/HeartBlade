import * as native from "./native";
import * as metro from "./metro";
import * as patcher from "./patcher";
import { readRegistry } from "./plugins";
import { log, warn, error } from "./log";

/**
 * Theme file format (JSON):
 * {
 *   "name": "Crimson", "author": "you", "version": "1.0.0",
 *   "semanticColors": { "BACKGROUND_PRIMARY": { "dark": "#14080a", "light": "#fff5f5" } },
 *   "rawColors": { "PRIMARY_660": "#2a0d12" }
 * }
 * Colour names are Discord's own semantic / raw colour token names.
 */
interface Theme {
  name?: string;
  semanticColors?: Record<string, { dark?: string; light?: string } | string>;
  rawColors?: Record<string, string>;
}

let undo: Array<() => void> = [];

export function removeTheme() {
  while (undo.length) { try { undo.pop()!(); } catch { /* ignore */ } }
}

export function applyTheme(theme: Theme) {
  removeTheme();

  // 1) Raw colour palette: overwrite in place (restored on removal).
  const rawMod = metro.find((m) => m.unsafe_rawColors || (m.colors && m.meta));
  const raw = rawMod?.unsafe_rawColors ?? rawMod?.colors?.unsafe_rawColors;
  if (raw && theme.rawColors) {
    for (const [k, v] of Object.entries(theme.rawColors)) {
      const prev = raw[k];
      try { raw[k] = v; undo.push(() => { raw[k] = prev; }); } catch { warn(`raw colour ${k} is read-only`); }
    }
  }

  // 2) Semantic colours: override the resolver for tokens the theme names.
  if (theme.semanticColors) {
    const meta = rawMod?.meta ?? rawMod?.default?.meta;
    const tokens = rawMod?.colors ?? rawMod?.default?.colors;
    if (meta?.resolveSemanticColor && tokens) {
      const nameOf = new Map<any, string>();
      for (const k of Object.keys(tokens)) { try { nameOf.set(tokens[k], k); } catch { /* ignore */ } }
      undo.push(
        patcher.after(meta, "resolveSemanticColor", (args, ret) => {
          const name = nameOf.get(args[1]);
          const o = name ? theme.semanticColors![name] : undefined;
          if (!o) return;
          if (typeof o === "string") return o;
          return (args[0] === "light" ? o.light : o.dark) ?? undefined;
        })
      );
    } else warn("semantic colour resolver not found — only raw colours applied");
  }
  log(`theme applied: ${theme.name ?? "unnamed"}`);
}

export function startEnabledTheme() {
  const entry = readRegistry().find((e) => e.type === "theme" && e.enabled);
  if (!entry) return;
  const theme = native.readJSON<Theme | null>(`themes/${entry.id}.json`, null);
  if (!theme) { error(`theme ${entry.id}: file missing`); return; }
  try { applyTheme(theme); } catch (e) { error("theme failed", e); }
}
