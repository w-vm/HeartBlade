import * as native from "./native";
import { readRegistry, RegistryEntry } from "./plugins";
import { log } from "./log";
import { BRAND } from "./brand";

// JS-side plugin / theme management (the same on-disk layout the native Store.m uses):
//   registry.json, plugins/<id>/{manifest.json,index.js}, themes/<id>.json
// NOTE: no async/await on purpose - Hermes gets this bundle as raw source (no Babel), so plain Promises only.

export type Kind = "plugin" | "theme";
export interface Meta { name: string; version?: string; author?: string; description?: string; }

let changed = false;                              // installs, removals, updates: always need a refresh
const bootState = new Map<string, boolean>();    // enabled state of every entry as it was when this session started (recorded at the first toggle)
/** True when something was installed / removed / updated, or a plugin or theme now differs from what is running. Switching one off and on again needs nothing. */
export const needsRestart = () => {
  if (changed) return true;
  if (!bootState.size) return false;
  const now = new Map(readRegistry().map((e) => [e.type + ":" + e.id, !!e.enabled] as [string, boolean]));
  for (const [k, v] of bootState) if (now.get(k) !== v) return true;
  return false;
};
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
  for (const e of reg) { const k = e.type + ":" + e.id; if (!bootState.has(k)) bootState.set(k, !!e.enabled); }
  for (const e of reg) {
    if (e.type !== type) continue;
    if (e.id === id) e.enabled = enabled;
    else if (type === "theme" && enabled) e.enabled = false; // one active theme
  }
  saveRegistry(reg);
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
/**
 * A GitHub page link (github.com/<owner>/<repo>/tree|blob|raw/<ref>/<path>) points at an HTML page, not at the file itself.
 * Turn it into the raw file link so the manifest and script are read correctly.
 */
export function normalizeGithub(u: string): string {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^\/\s]+)\/([^\/\s]+)\/(?:tree|blob|raw)\/([^\/\s]+)\/([^?#\s]+?)\/?(?:[?#].*)?$/i.exec(u);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}` : u;
};
const parseUrl = (s: string): string | null => {
  const t = (s ?? "").trim();
  return /^https?:\/\/[^\/?#\s]+/i.test(t) ? normalizeGithub(t) : null;
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

interface Fetched { manifest: any; js: string; scriptUrl: string; }

/** Downloads a plugin's manifest + script from a folder link, a manifest.json link or a single .js link. */
function fetchPlugin(url: string): Promise<Fetched> {
  const last = (url.split(/[?#]/)[0].split("/").pop() ?? "");
  let manifestUrl: string | null = null;
  let scriptUrl: string;
  let sibling = "";
  if (last.endsWith(".js")) {                                                       // single-file plugin
    scriptUrl = url;
    // A manifest.json next to the script (same folder) still names the plugin; it is only trusted when it describes this file.
    manifestUrl = url.split(/[?#]/)[0].replace(/[^\/]*$/, "") + "manifest.json";
    sibling = last;
  }
  else if (last.endsWith(".json")) { manifestUrl = url; scriptUrl = ""; }          // manifest link (script = manifest.main)
  else {                                                                            // folder
    const base = url.endsWith("/") ? url : url + "/";
    manifestUrl = base + "manifest.json"; scriptUrl = base + "index.js";
  }

  const manifestP: Promise<any> = manifestUrl
    ? getText(manifestUrl).then((t) => { try { const j = JSON.parse(t); return j && typeof j === "object" ? j : {}; } catch { return {}; } }, () => ({}))
    : Promise.resolve({});

  return manifestP.then((manifest: any) => {
    if (sibling && manifest && typeof manifest.main === "string" && manifest.main.replace(/^\.\//, "") !== sibling) manifest = {};   // belongs to another file
    if (sibling && !(manifest && typeof manifest.name === "string")) manifest = {};
    if (last.endsWith(".json")) scriptUrl = resolveRel(manifestUrl!, typeof manifest.main === "string" ? manifest.main : "index.js");
    return getText(scriptUrl).then((js) => ({ manifest, js, scriptUrl }));
  });
}

const writePlugin = (id: string, f: Fetched) => {
  native.writeFile(`plugins/${id}/index.js`, f.js);
  native.writeFile(`plugins/${id}/manifest.json`, JSON.stringify({ ...f.manifest, name: f.manifest.name ?? id }));
};

export function installPlugin(input: string): Promise<string> {
  const url = parseUrl(input);
  if (!url) return Promise.reject(new Error("Invalid URL"));
  return fetchPlugin(url).then((f) => {
    const { manifest, scriptUrl } = f;
    const name = typeof manifest.name === "string" ? manifest.name : null;
    let id = sanitize(typeof manifest.id === "string" ? manifest.id : name ?? "");
    if (!id) id = sanitize((scriptUrl.split(/[?#]/)[0].split("/").pop() ?? "plugin").replace(/\.[^.]*$/, "") + "-" + shortHash(scriptUrl));
    if (!id) id = "plugin-" + shortHash(scriptUrl);
    writePlugin(id, f);
    upsert("plugin", id, url);
    markChanged();
    log(`installed plugin ${id}`);
    return `Installed “${manifest.name ?? id}”`;
  });
}

export interface PluginUpdateResult { updated: string[]; current: number; failed: number; }

/**
 * Manual plugin update (the plugins page button): re-downloads every installed plugin from the link it was installed with
 * and replaces it only when its script or version actually changed. Enabled state and saved data are kept.
 */
export function updatePlugins(): Promise<PluginUpdateResult> {
  const res: PluginUpdateResult = { updated: [], current: 0, failed: 0 };
  let chain: Promise<void> = Promise.resolve();
  for (const e of readRegistry().filter((x) => x.type === "plugin")) {
    const url = parseUrl(e.url);
    if (!url) { res.failed++; continue; }
    chain = chain.then(() => fetchPlugin(url).then((f) => {
      const before = readMeta("plugin", e.id);
      const same = native.readFile(`plugins/${e.id}/index.js`) === f.js && String(before.version ?? "") === String(f.manifest.version ?? "");
      if (same) { res.current++; return; }
      writePlugin(e.id, f);
      if (url !== e.url) upsert("plugin", e.id, url);
      const to = typeof f.manifest.version === "string" ? f.manifest.version : "";
      res.updated.push(`${f.manifest.name ?? before.name}${before.version && to && before.version !== to ? ` (${before.version} to ${to})` : ""}`);
      log(`updated plugin ${e.id}`);
    }).catch((err: any) => { res.failed++; log(`plugin update failed for ${e.id}: ${String(err?.message ?? err)}`); }));
  }
  return chain.then(() => { if (res.updated.length) markChanged(); return res; });
}

/**
 * Manual theme update (the themes page button): re-downloads every installed theme from the link it was installed with
 * and replaces it only when the file changed. Enabled state is kept; Discord needs a restart to show it.
 */
export function updateThemes(): Promise<PluginUpdateResult> {
  const res: PluginUpdateResult = { updated: [], current: 0, failed: 0 };
  let chain: Promise<void> = Promise.resolve();
  for (const e of readRegistry().filter((x) => x.type === "theme")) {
    const url = parseUrl(e.url);
    if (!url) { res.failed++; continue; }
    chain = chain.then(() => getText(url).then((t) => {
      let theme: any;
      try { theme = JSON.parse(t); } catch { throw new Error("Not valid JSON"); }
      const ok = theme && typeof theme === "object" && ((theme.semanticColors && typeof theme.semanticColors === "object") || (theme.rawColors && typeof theme.rawColors === "object"));
      if (!ok) throw new Error("Not a HeartBlade theme");
      const before = readMeta("theme", e.id);
      if (native.readFile(`themes/${e.id}.json`) === t) { res.current++; return; }
      native.writeFile(`themes/${e.id}.json`, t);
      if (url !== e.url) upsert("theme", e.id, url);
      const to = typeof theme.version === "string" ? theme.version : "";
      res.updated.push(`${typeof theme.name === "string" ? theme.name : before.name}${before.version && to && before.version !== to ? ` (${before.version} to ${to})` : ""}`);
      log(`updated theme ${e.id}`);
    }).catch((err: any) => { res.failed++; log(`theme update failed for ${e.id}: ${String(err?.message ?? err)}`); }));
  }
  return chain.then(() => { if (res.updated.length) markChanged(); return res; });
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
    upsert("theme", id, url);
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
