import * as metro from "./metro";
import * as native from "./native";
import { log, warn } from "./log";

/**
 * Adds a "HeartBlade" row to Discord's settings screen that opens the native panel.
 * Discord's settings internals change between versions, so this is heuristic: it records
 * what it found (see the debug report) and only reports success when the row was inserted.
 */
export interface SettingsReport { rendererFound: boolean; listInserted: boolean; candidates: Array<{ keys: string[] }>; error?: string; }

function findKeyList(root: any): string[] | null {
  const seen = new Set<any>();
  const walk = (o: any, depth: number): string[] | null => {
    if (!o || typeof o !== "object" || seen.has(o) || depth > 4) return null;
    seen.add(o);
    if (Array.isArray(o) && o.includes("ACCOUNT") && o.includes("ADVANCED") && o.every((x) => typeof x === "string")) return o;
    let keys: string[] = [];
    try { keys = Object.keys(o); } catch { return null; }
    for (const k of keys.slice(0, 60)) {
      let v: any; try { v = o[k]; } catch { continue; }
      const hit = walk(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root, 0);
}

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

    cfg.HEARTBLADE = {
      type: "pressable",
      title: () => "HeartBlade",
      onPress: () => native.openPanel(),
      icon: undefined,
    };

    for (const m of metro.findAllLoaded(() => true)) {
      const list = findKeyList(m);
      if (list && !list.includes("HEARTBLADE")) { list.unshift("HEARTBLADE"); report.listInserted = true; break; }
    }
    if (report.listInserted) { native.setSettingsEntry(true); log("settings: HeartBlade row inserted"); }
    else warn("settings: could not find the settings list");
  } catch (e: any) {
    report.error = String(e?.message ?? e);
    warn("settings: failed", report.error);
  }
  return report;
}
