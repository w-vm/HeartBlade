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
  cfgKeyCount?: number; cfgSample?: string[]; entryShape?: any; hits?: Array<{ path: string; len: number; score: number; head: string[] }>;
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

export function installSettingsEntry(): SettingsReport {
  const report: SettingsReport = { rendererFound: false, listInserted: false, candidates: [] };
  try {
    for (const m of metro.findAllLoaded((e) => { try { return Object.keys(e).some((k) => /^SETTING/i.test(k)); } catch { return false; } }).slice(0, 12)) {
      report.candidates.push({ keys: Object.keys(m).filter((k) => /^SETTING/i.test(k)) });
    }

    const mod = metro.findLoaded((e) => !!e.SETTING_RENDERER_CONFIG);
    const cfg = mod?.SETTING_RENDERER_CONFIG;
    if (!cfg) { warn("settings: renderer config not found"); return report; }
    report.rendererFound = true;

    const cfgKeys = new Set<string>(Object.keys(cfg));
    report.cfgKeyCount = cfgKeys.size;
    report.cfgSample = [...cfgKeys].slice(0, 25);
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
    if (best) { best.arr.unshift("HEARTBLADE"); report.listInserted = true; }
    if (report.listInserted) { native.setSettingsEntry(true); log("settings: HeartBlade row inserted"); }
    else warn("settings: could not find the settings list");
  } catch (e: any) {
    report.error = String(e?.message ?? e);
    warn("settings: failed", report.error);
  }
  return report;
}
