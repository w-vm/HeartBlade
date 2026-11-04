import * as metro from "./metro";
import * as native from "./native";
import { log, warn } from "./log";

/**
 * Adds a "HeartBlade" row to Discord's settings screen that opens the native panel.
 * Discord's settings internals change between versions, so this is heuristic: it records
 * what it found (see the debug report) and only reports success when the row was inserted.
 */
export interface SettingsReport {
  rendererFound: boolean; listInserted: boolean; candidates: Array<{ keys: string[] }>; error?: string;
  cfgKeyCount?: number; cfgInfo?: any; moduleKeys?: Record<string, string[]>; rendererLike?: Array<{ path: string; keyCount: number; sample: string[] }>; attempts?: number; cfgSample?: string[]; entryShape?: any; hits?: Array<{ path: string; len: number; score: number; head: string[] }>;
}

interface Hit { arr: string[]; path: string; score: number }

/** Finds arrays of strings that mostly consist of keys of the settings renderer config. */
function findKeyLists(root: any, cfgKeys: Set<string>, modPath: string, out: Hit[]) {
  const seen = new Set<any>();
  let budget = 4000;
  const walk = (o: any, depth: number, path: string) => {
    if (!o || typeof o !== "object" || seen.has(o) || depth > 6 || budget-- <= 0) return;
    seen.add(o);
    if (Array.isArray(o)) {
      if (o.length >= 3 && o.every((x) => typeof x === "string")) {
        const score = o.reduce((n, x) => n + (cfgKeys.has(x) ? 1 : 0), 0);
        if (score >= 3) out.push({ arr: o, path, score });
        return;
      }
      for (let i = 0; i < Math.min(o.length, 60); i++) walk(o[i], depth + 1, `${path}[${i}]`);
      return;
    }
    // Only plain objects: never touch host objects, proxies or class instances.
    if (Object.getPrototypeOf(o) !== Object.prototype) return;
    for (const k of Object.keys(o).slice(0, 80)) {
      const d = Object.getOwnPropertyDescriptor(o, k);
      if (!d || !("value" in d)) continue; // skip getters
      walk(d.value, depth + 1, `${path}.${k}`);
    }
  };
  walk(root, 0, modPath);
}

const shapeOf = (e: any) => {
  const o: any = {};
  try { for (const k of Object.keys(e).slice(0, 20)) o[k] = typeof e[k] === "function" ? "fn" : typeof e[k] === "object" ? "obj" : e[k]; } catch { /* ignore */ }
  return o;
};


const describe = (o: any) => {
  const r: any = {};
  try { r.type = typeof o; r.ctor = o?.constructor?.name; r.plainProto = Object.getPrototypeOf(o) === Object.prototype;
    r.ownNames = Object.getOwnPropertyNames(o).length; r.symbols = Object.getOwnPropertySymbols(o).length;
    let n = 0; for (const _ in o) n++; r.forIn = n; r.frozen = Object.isFrozen(o); } catch (e: any) { r.err = String(e?.message ?? e); }
  return r;
};

/** Plain objects with many entries whose values look like { type: "...", ... } renderer definitions. */
function findRendererLike(root: any, modPath: string, out: Array<{ path: string; keyCount: number; sample: string[]; obj: any }>) {
  const check = (o: any, path: string) => {
    try {
      if (!o || typeof o !== "object" || Array.isArray(o) || Object.getPrototypeOf(o) !== Object.prototype) return;
      const keys = Object.keys(o);
      if (keys.length < 20) return;
      let ok = 0; const first = keys.slice(0, 30);
      for (const k of first) { const d = Object.getOwnPropertyDescriptor(o, k); const v = d && "value" in d ? d.value : null; if (v && typeof v === "object" && typeof v.type === "string") ok++; }
      if (ok >= first.length * 0.7) out.push({ path, keyCount: keys.length, sample: keys.slice(0, 8), obj: o });
    } catch { /* ignore */ }
  };
  check(root, modPath);
  try {
    if (root && typeof root === "object" && Object.getPrototypeOf(root) === Object.prototype)
      for (const k of Object.keys(root).slice(0, 40)) { const d = Object.getOwnPropertyDescriptor(root, k); if (d && "value" in d) check(d.value, `${modPath}.${k}`); }
  } catch { /* ignore */ }
}

let done = false;
let attempts = 0;

export const settingsDone = () => done;

export function installSettingsEntry(): SettingsReport {
  const report: SettingsReport = { rendererFound: false, listInserted: false, candidates: [] };
  try {
    for (const m of metro.findAllLoaded((e) => { try { return Object.keys(e).some((k) => /^SETTING/i.test(k)); } catch { return false; } }).slice(0, 12)) {
      report.candidates.push({ keys: Object.keys(m).filter((k) => /^SETTING/i.test(k)) });
    }

    report.attempts = ++attempts;
    const mod = metro.findLoaded((e) => !!e.SETTING_RENDERER_CONFIG);
    let cfg = mod?.SETTING_RENDERER_CONFIG;
    if (!cfg) { if (attempts <= 1) warn("settings: renderer config not found"); return report; }
    report.rendererFound = true;
    report.cfgInfo = describe(cfg);
    report.moduleKeys = {};
    for (const m of metro.findAllLoaded((e) => { try { return Object.keys(e).some((k) => /^SETTING/i.test(k)); } catch { return false; } }).slice(0, 8)) {
      try { report.moduleKeys[Object.keys(m).filter((k) => /^SETTING/i.test(k))[0]] = Object.keys(m).slice(0, 15); } catch { /* ignore */ }
    }

    let cfgKeys = new Set<string>(Object.keys(cfg));
    if (cfgKeys.size < 10) {
      // The exported config is empty at this point; look for the object that actually holds the definitions.
      const like: Array<{ path: string; keyCount: number; sample: string[]; obj: any }> = [];
      let j = 0;
      for (const m of metro.findAllLoaded(() => true)) findRendererLike(m, `m${j++}`, like);
      like.sort((x, y) => y.keyCount - x.keyCount);
      report.rendererLike = like.slice(0, 4).map(({ path, keyCount, sample }) => ({ path, keyCount, sample }));
      if (like.length) { cfg = like[0].obj; cfgKeys = new Set<string>(Object.keys(cfg)); }
    }
    report.cfgKeyCount = cfgKeys.size;
    report.cfgSample = [...cfgKeys].slice(0, 25);
    if (cfgKeys.size < 10) { if (attempts <= 1 || attempts % 15 === 0) warn("settings: renderer config is still empty (will retry)"); return report; }
    const sample = cfg.ACCOUNT ?? cfg[report.cfgSample[0]];
    report.entryShape = shapeOf(sample);

    cfg.HEARTBLADE = {
      type: "pressable",
      title: () => "HeartBlade",
      onPress: () => native.openPanel(),
      icon: undefined,
    };

    const hits: Hit[] = [];
    let i = 0;
    for (const m of metro.findAllLoaded(() => true)) {
      if (m === cfg || m === mod) continue;
      findKeyLists(m, cfgKeys, `m${i++}`, hits);
    }
    // Prefer lists that look like the top-level settings list, then the biggest overlap.
    const rank = (h: Hit) => h.score + (h.arr.includes("ACCOUNT") ? 100 : 0) + (h.arr.includes("ADVANCED") ? 100 : 0);
    hits.sort((x, y) => rank(y) - rank(x));
    report.hits = hits.slice(0, 6).map((h) => ({ path: h.path, len: h.arr.length, score: h.score, head: h.arr.slice(0, 6) }));

    const best = hits.find((h) => !h.arr.includes("HEARTBLADE"));
    if (best) { best.arr.unshift("HEARTBLADE"); report.listInserted = true; done = true; }
    if (report.listInserted) { native.setSettingsEntry(true); log("settings: HeartBlade row inserted"); }
    else if (attempts <= 1 || attempts % 15 === 0) warn("settings: could not find the settings list (will retry)");
  } catch (e: any) {
    report.error = String(e?.message ?? e);
    warn("settings: failed", report.error);
  }
  return report;
}
