import * as native from "./native";
import { readRegistry, RegistryEntry } from "./plugins";
import { log } from "./log";
import { BRAND } from "./brand";

// JS-side plugin / theme management (the same on-disk layout the native Store.m uses):
//   registry.json, plugins/<id>/{manifest.json,index.js}, themes/<id>.json
// NOTE: no async/await on purpose - Hermes gets this bundle as raw source (no Babel), so plain Promises only.

export type Kind = "plugin" | "theme";
export interface Meta { name: string; version?: string; author?: string; description?: string; }

let changed = false;
/** True once something was installed / toggled / removed in this session (the UI then offers a restart). */
export const needsRestart = () => changed;
export const markChanged = () => { changed = true; };

export const listEntries = (kind: Kind): RegistryEntry[] => readRegistry().filter((e) => e.type === kind);

export function readMeta(kind: Kind, id: string): Meta {
  if (kind === "plugin") {
    const m = native.readJSON<any>(`plugins/${id}/manifest.json`, {});
    return { name: typeof m?.name === "string" ? m.name : id, version: m?.version, author: m?.author, description: m?.description };
  }
  const t = native.readJSON<any>(`themes/${id}.json`, {});
  return { name: typeof t?.name === "string" ? t.name : id, version: t?.version, author: t?.author, description: t?.description };
}

function saveRegistry(reg: RegistryEntry[]) { native.writeJSON("registry.json", reg); }

function upsert(type: Kind, id: string, url: string) {
  const reg = readRegistry();
  const hit = reg.find((e) => e.type === type && e.id === id);
  if (hit) hit.url = url; else reg.push({ type, id, url, enabled: true });
  saveRegistry(reg);
}

export function setEnabled(type: Kind, id: string, enabled: boolean) {
  const reg = readRegistry();
  for (const e of reg) {
    if (e.type !== type) continue;
    if (e.id === id) e.enabled = enabled;
    else if (type === "theme" && enabled) e.enabled = false; // one active theme
  }
  saveRegistry(reg);
  markChanged();
}

export function remove(type: Kind, id: string) {
  saveRegistry(readRegistry().filter((e) => !(e.type === type && e.id === id)));
  if (type === "plugin") { native.removeFile(`plugins/${id}`); native.removeFile(`data/${id}.json`); }
  else native.removeFile(`themes/${id}.json`);
  markChanged();
}

// ---- helpers ------------------------------------------------------------------------------------------------

const sanitize = (s: string): string | null => {
  let out = s.toLowerCase().replace(/ /g, "-").replace(/[^a-z0-9\-_.]/g, "");
  out = out.replace(/^\.+/, "");
  return out || null;
};
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ("00000000" + h.toString(16)).slice(-8);
}
const parseUrl = (s: string): string | null => {
  const t = (s ?? "").trim();
  return /^https?:\/\/[^\/?#\s]+/i.test(t) ? t : null;
};
const hostOf = (u: string) => (/^https?:\/\/([^\/?#]+)/i.exec(u)?.[1] ?? u);

function resolveRel(base: string, rel: string): string {
  if (/^https?:\/\//i.test(rel)) return rel;
  const m = /^(https?:\/\/[^\/?#]+)([^?#]*)/i.exec(base)!;
  let path = m[2] || "/";
  path = rel.startsWith("/") ? rel : path.slice(0, path.lastIndexOf("/") + 1) + rel;
  const out: string[] = [];
  for (const seg of path.split("/")) { if (seg === "..") { if (out.length > 1) out.pop(); } else if (seg !== ".") out.push(seg); }
  return m[1] + out.join("/");
}

// raw.githubusercontent.com answers from a ~5 minute cache; a throw-away query makes every download fresh.
const fresh = (u: string) => (/^https?:\/\/raw\.githubusercontent\.com\//i.test(u) ? u + (u.includes("?") ? "&" : "?") + "hb=" + Date.now() : u);

export function getText(url: string): Promise<string> {
  const f = (globalThis as any).fetch;
  if (typeof f !== "function") return Promise.reject(new Error("fetch is not available"));
  return f(fresh(url), { headers: { "Cache-Control": "no-cache" } }).then((res: any) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${hostOf(url)}`);
    return res.text();
  }).then((t: string) => {
    if (!t) throw new Error(`empty response from ${hostOf(url)}`);
    return t;
  });
}

// ---- install ------------------------------------------------------------------------------------------------

export function installPlugin(input: string): Promise<string> {
  const url = parseUrl(input);
  if (!url) return Promise.reject(new Error("Invalid URL"));
  const last = (url.split(/[?#]/)[0].split("/").pop() ?? "");
  let manifestUrl: string | null = null;
  let scriptUrl: string;
  if (last.endsWith(".js")) { scriptUrl = url; }                                   // single-file plugin
  else if (last.endsWith(".json")) { manifestUrl = url; scriptUrl = ""; }          // manifest link (script = manifest.main)
  else {                                                                            // folder
    const base = url.endsWith("/") ? url : url + "/";
    manifestUrl = base + "manifest.json"; scriptUrl = base + "index.js";
  }

  const manifestP: Promise<any> = manifestUrl
    ? getText(manifestUrl).then((t) => { try { const j = JSON.parse(t); return j && typeof j === "object" ? j : {}; } catch { return {}; } }, () => ({}))
    : Promise.resolve({});

  return manifestP.then((manifest: any) => {
    if (last.endsWith(".json")) scriptUrl = resolveRel(manifestUrl!, typeof manifest.main === "string" ? manifest.main : "index.js");
    return getText(scriptUrl).then((js) => {
      const name = typeof manifest.name === "string" ? manifest.name : null;
      let id = sanitize(typeof manifest.id === "string" ? manifest.id : name ?? "");
      if (!id) id = sanitize((scriptUrl.split(/[?#]/)[0].split("/").pop() ?? "plugin").replace(/\.[^.]*$/, "") + "-" + shortHash(scriptUrl));
      if (!id) id = "plugin-" + shortHash(scriptUrl);
      native.writeFile(`plugins/${id}/index.js`, js);
      native.writeFile(`plugins/${id}/manifest.json`, JSON.stringify({ ...manifest, name: manifest.name ?? id }));
      upsert("plugin", id, input);
      markChanged();
      log(`installed plugin ${id}`);
      return `Installed “${manifest.name ?? id}”`;
    });
  });
}

export function installTheme(input: string): Promise<string> {
  const url = parseUrl(input);
  if (!url) return Promise.reject(new Error("Invalid URL"));
  return getText(url).then((t) => {
    let theme: any;
    try { theme = JSON.parse(t); } catch { throw new Error("Not valid JSON"); }
    const ok = theme && typeof theme === "object" && ((theme.semanticColors && typeof theme.semanticColors === "object") || (theme.rawColors && typeof theme.rawColors === "object"));
    if (!ok) throw new Error("Not a HeartBlade theme (needs semanticColors or rawColors)");
    const name = typeof theme.name === "string" ? theme.name : "theme";
    const id = sanitize(name) ?? shortHash(input);
    native.writeFile(`themes/${id}.json`, t);
    upsert("theme", id, input);
    setEnabled("theme", id, true);
    log(`installed theme ${id}`);
    return `Installed “${name}”`;
  });
}

// ---- client bundle ------------------------------------------------------------------------------------------

/** Download the client bundle (dev URL if set, otherwise the release URL) for the next launch. */
export function updateClient(): Promise<boolean> {
  const p = native.getPrefs();
  // An old .deb has no prefs API: use the release URL, which is the same one the native side downloads from.
  const url = (p ? (parseUrl(p.devURL) ?? parseUrl(p.bundleURL)) : null) ?? BRAND.bundleUrl;
  return getText(url).then((t) => {
    if (t.length < 200) throw new Error("Downloaded file is too small to be the client");
    native.writeFile("bundle.js", t);
    native.removeFile("bundle.etag");
    log(`client updated from ${hostOf(url)} (${t.length} bytes)`);
    markChanged();
    return true;
  });
}

/**
 * Re-downloads every installed plugin and theme from the link it was installed with (used by "Update client").
 * Enabled / disabled state and a plugin's saved data are kept; a theme is rewritten without changing which one is active.
 */
export function updateAll(): Promise<{ ok: number; failed: number; lines: string[] }> {
  const res = { ok: 0, failed: 0, lines: [] as string[] };
  let chain: Promise<void> = Promise.resolve();
  for (const e of readRegistry()) {
    const before = readMeta(e.type, e.id);
    const job = e.type === "plugin"
      ? () => installPlugin(e.url).then(() => undefined)
      : () => getText(e.url).then((t) => {
        const th = JSON.parse(t);
        if (!th || typeof th !== "object" || !(th.semanticColors || th.rawColors)) throw new Error("not a theme");
        native.writeFile(`themes/${e.id}.json`, t);
      });
    chain = chain.then(job).then(() => {
      res.ok++;
      const after = readMeta(e.type, e.id);
      res.lines.push(`${after.name}: ${before.version && after.version && before.version !== after.version ? `${before.version} to ${after.version}` : after.version ? `v${after.version} (already current)` : "refreshed"}`);
    }, (err: any) => { res.failed++; res.lines.push(`${before.name}: failed (${String(err?.message ?? err)})`); log(`update failed for ${e.type} ${e.id}: ${String(err?.message ?? err)}`); });
  }
  return chain.then(() => { markChanged(); return res; });
}
