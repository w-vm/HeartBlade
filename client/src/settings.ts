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
  unsupported?: boolean; scan?: any; scan2?: any; probe?: any; settingsExports?: Array<{ m: number; key: string; kind: string }>; cfgKeyCount?: number; cfgInfo?: any; moduleKeys?: Record<string, string[]>; rendererLike?: Array<{ path: string; keyCount: number; sample: string[] }>; attempts?: number; cfgSample?: string[]; entryShape?: any; hits?: Array<{ path: string; len: number; score: number; head: string[] }>;
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

/** Read-only scan for where Discord's mobile settings screen is defined. Never mutates anything. */
function scanSettingsScreen() {
  const out: any = { acct: [], named: [], routes: [] };
  const NAME = /^(UserSettings|Settings)(Overview|List|Screen|Root|Home|Main|Row|Section|Navigator|Page)|SettingsOverview|SettingsScreen/;
  let i = 0;
  for (const m of metro.findAllLoaded(() => true)) {
    const idx = i++;
    try {
      const keys = Object.keys(m);
      for (const k of keys.slice(0, 300)) {
        if (NAME.test(k) && out.named.length < 40) out.named.push({ m: idx, key: k, kind: typeof (m as any)[k] });
      }
      // objects / arrays that contain the classic top-level settings route names
      const seen = new Set<any>(); let budget = 600;
      const walk = (o: any, depth: number, path: string) => {
        if (!o || typeof o !== "object" || seen.has(o) || depth > 4 || budget-- <= 0) return;
        seen.add(o);
        if (Array.isArray(o)) {
          if (o.length && o.length < 80 && o.some((x) => x === "ACCOUNT" || x === "PRIVACY_AND_SAFETY") && out.acct.length < 12)
            out.acct.push({ path, kind: "array", len: o.length, head: o.slice(0, 8).map((x) => (typeof x === "string" ? x : typeof x === "object" ? Object.keys(x ?? {}).slice(0, 6).join(",") : typeof x)) });
          else for (let q = 0; q < Math.min(o.length, 40); q++) walk(o[q], depth + 1, `${path}[${q}]`);
          return;
        }
        if (Object.getPrototypeOf(o) !== Object.prototype) return;
        const ks = Object.keys(o).slice(0, 120);
        if ((ks.includes("ACCOUNT") || ks.includes("PRIVACY_AND_SAFETY")) && out.acct.length < 12)
          out.acct.push({ path, kind: "object", n: ks.length, head: ks.slice(0, 10), valKind: typeof (o as any)[ks[0]] });
        for (const k of ks) { const d = Object.getOwnPropertyDescriptor(o, k); if (d && "value" in d) walk(d.value, depth + 1, `${path}.${k}`); }
      };
      walk(m, 0, `m${idx}`);
    } catch { /* ignore */ }
  }
  return out;
}

/** Read-only: find containers keyed by (or listing) the values of UserSettingsPath, i.e. the real settings tree/list. */
function scanByPathValues() {
  const res: any = { pathValues: [], hits: [] };
  const holder = metro.findLoaded((e) => !!e.UserSettingsPath);
  const enumObj = holder?.UserSettingsPath;
  if (!enumObj || typeof enumObj !== "object") { res.error = "UserSettingsPath missing"; return res; }
  const vals = new Set<string>(Object.values(enumObj).filter((v) => typeof v === "string") as string[]);
  res.pathValues = [...vals].slice(0, 40);
  let i = 0;
  for (const m of metro.findAllLoaded(() => true)) {
    const idx = i++;
    if (m === enumObj) continue;
    try {
      const seen = new Set<any>(); let budget = 3000;
      const walk = (o: any, depth: number, path: string) => {
        if (!o || (typeof o !== "object" && typeof o !== "function") || seen.has(o) || depth > 6 || budget-- <= 0) return;
        seen.add(o);
        if (o === enumObj) return;
        let n = 0; let kind = ""; let sample: string[] = [];
        if (Array.isArray(o)) {
          kind = "array";
          for (const x of o.slice(0, 200)) if (typeof x === "string" && vals.has(x)) { n++; if (sample.length < 6) sample.push(x); }
          if (n < 6) for (let q = 0; q < Math.min(o.length, 40); q++) walk(o[q], depth + 1, `${path}[${q}]`);
        } else if (o instanceof Map) {
          kind = "map";
          for (const k of o.keys()) if (typeof k === "string" && vals.has(k)) { n++; if (sample.length < 6) sample.push(k); }
        } else if (typeof o === "object" && Object.getPrototypeOf(o) === Object.prototype) {
          kind = "object";
          const ks = Object.keys(o).slice(0, 300);
          for (const k of ks) if (vals.has(k)) { n++; if (sample.length < 6) sample.push(k); }
          if (n < 6) for (const k of ks.slice(0, 80)) { const d = Object.getOwnPropertyDescriptor(o, k); if (d && "value" in d) walk(d.value, depth + 1, `${path}.${k}`); }
        }
        if (n >= 6 && res.hits.length < 10) {
          let first: any = null;
          try { const k0 = sample[0]; const v0 = kind === "object" ? (o as any)[k0] : kind === "map" ? o.get(k0) : null; first = v0 && typeof v0 === "object" ? Object.keys(v0).slice(0, 12).map((k) => `${k}:${typeof v0[k]}`) : typeof v0; } catch { /* ignore */ }
          res.hits.push({ path, kind, n, sample, first });
        }
      };
      walk(m, 0, `m${idx}`);
    } catch { /* ignore */ }
  }
  return res;
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
    const cfg = mod?.SETTING_RENDERER_CONFIG;
    if (!cfg) { if (attempts <= 1) warn("settings: renderer config not found"); return report; }
    report.rendererFound = true;
    report.cfgInfo = { ...describe(cfg), fnName: (cfg as any).name, fnLen: (cfg as any).length };

    // Only a plain object of definitions is understood. Anything else means Discord changed its settings
    // internals: stop (no retries, no guessing, nothing gets modified) and collect hints for the next fix.
    if (typeof cfg !== "object" || Object.getPrototypeOf(cfg) !== Object.prototype) {
      done = true;
      report.unsupported = true;
      const found: Array<{ m: number; key: string; kind: string }> = [];
      let j = 0;
      for (const m of metro.findAllLoaded(() => true)) {
        const idx = j++;
        try {
          for (const k of Object.keys(m).slice(0, 200)) {
            if (!/setting/i.test(k)) continue;
            const d = Object.getOwnPropertyDescriptor(m, k);
            if (!d || !("value" in d)) continue;
            const v = d.value;
            if (typeof v === "function" || (v && typeof v === "object")) found.push({ m: idx, key: k, kind: typeof v });
          }
        } catch { /* ignore */ }
        if (found.length >= 12) break;
      }
      report.settingsExports = found.slice(0, 3);
      // Probe: it may be a lazy getter that returns the real config. Read-only, we only record its shape.
      try {
        const r = (cfg as any)();
        report.probe = { type: typeof r, plain: !!r && Object.getPrototypeOf(r) === Object.prototype, count: r && typeof r === "object" ? Object.keys(r).length : 0, sample: r && typeof r === "object" ? Object.keys(r).slice(0, 15) : [], entry: r && typeof r === "object" ? shapeOf(r[Object.keys(r)[0]]) : null };
      } catch (e: any) { report.probe = { error: String(e?.message ?? e) }; }
      try { report.scan = scanSettingsScreen(); report.scan2 = scanByPathValues(); } catch (e: any) { report.scan = { error: String(e?.message ?? e) }; }
      warn("settings: unsupported Discord settings layout, row not added (use the shake gesture)");
      return report;
    }

    const cfgKeys = new Set<string>(Object.keys(cfg));
    report.cfgKeyCount = cfgKeys.size;
    report.cfgSample = [...cfgKeys].slice(0, 25);
    if (cfgKeys.size < 10) { if (attempts <= 1 || attempts % 15 === 0) warn("settings: renderer config is still empty (will retry)"); return report; }
    report.entryShape = shapeOf(cfg.ACCOUNT ?? cfg[report.cfgSample[0]]);

    const hits: Hit[] = [];
    let i = 0;
    for (const m of metro.findAllLoaded(() => true)) {
      if (m === cfg || m === mod) continue;
      findKeyLists(m, cfgKeys, `m${i++}`, hits);
    }
    // A real settings list is made almost entirely of renderer keys.
    const good = hits.filter((h) => h.arr.length >= 5 && h.score >= h.arr.length * 0.6);
    const rank = (h: Hit) => h.score + (h.arr.includes("ACCOUNT") ? 100 : 0) + (h.arr.includes("ADVANCED") ? 100 : 0);
    good.sort((x, y) => rank(y) - rank(x));
    report.hits = hits.slice(0, 6).map((h) => ({ path: h.path, len: h.arr.length, score: h.score, head: h.arr.slice(0, 6) }));

    const best = good.find((h) => !h.arr.includes("HEARTBLADE"));
    if (best) {
      cfg.HEARTBLADE = { type: "pressable", title: () => "HeartBlade", onPress: () => native.openPanel(), icon: undefined };
      best.arr.unshift("HEARTBLADE");
      report.listInserted = true; done = true;
    }
    // Never tell the native side the row is active: we cannot verify it is visible, and that would disable the shake gesture.
    if (report.listInserted) log("settings: HeartBlade key added to a list (visibility unverified)");
    else if (attempts <= 1 || attempts % 15 === 0) warn("settings: could not find the settings list (will retry)");
  } catch (e: any) {
    report.error = String(e?.message ?? e);
    warn("settings: failed", report.error);
  }
  return report;
}
