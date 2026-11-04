import * as metro from "./metro";
import * as native from "./native";
import { log, warn } from "./log";
import { after } from "./patcher";
import { RootScreen, PageScreen, PAGE_ROUTE } from "./ui/pages";
import { LogoImage } from "./ui/kit";
import { setDiagHooks } from "./diag";

/**
 * Adds a "HeartBlade" row to the mobile Discord settings screen (same idea as Rain's settings/patches/tabs.tsx):
 *   1. SETTING_RENDERER_CONFIG (key -> row definition) is replaced by an accessor that returns the original plus our row.
 *   2. createList({ sections: [{ label, settings: [keys] }] }) (SettingBuilders) gets an "after" hook that splices an
 *      extra section into the overview screen's section array.
 *
 * 0.2.0: the row is now a real Discord "route" (same navigator / push animation as every other settings page) that opens
 * our own pages (src/ui/pages.ts) instead of a native modal. It is inserted at the very top of the overview list and uses
 * the HeartBlade logo instead of the borrowed "i" icon. The old native panel is still reachable by shaking the phone.
 *
 * What changed in 0.1.1 (row never appeared: sectionsInserted stayed 0):
 *   - We no longer poll for the settings modules. Discord loads them lazily, the first time Settings opens, and the
 *     overview list is built in that same render, so a 2s poll always installed the hook one render too late.
 *     Now every module is inspected the moment its factory finishes (before anything can call it), plus a scan of
 *     the modules that were already loaded.
 *   - createList is patched on EVERY module that exposes it (barrels / re-exports), not just the first match.
 *   - Patching uses defineProperty (see patcher.ts) and is verified, instead of a silently-ignored assignment.
 *   - The enum lookup is optional: "ACCOUNT" / "SUPPORT" string keys are used as a fallback.
 */
export interface SettingsReport {
  builders: boolean; enumFound: boolean; configFound: boolean; configKeys: number;
  configRegistered: boolean; patched: boolean; sectionsInserted: number; rowRendered: boolean;
  attempts: number; error?: string; hint?: any; guard?: string; desc?: any;
  createListTargets?: number; createListCalls?: number; overviewSeen?: boolean; patchErrors?: string[];
}

const KEY = "HEARTBLADE";
let done = false;
let attempts = 0;
let registered = false;
let inserted = 0;
let rendered = false;
let listening = false;
let overviewSeen = false;
let createListCalls = 0;
let configKeys = 0;
let lastSample: any;
let disabled = false;
const targets = new WeakSet<object>();
let targetCount = 0;
const patchErrors: string[] = [];

export const settingsDone = () => done;
setDiagHooks({ stats: () => settingsStats(), resetGuard: () => setGuard("ok", 0) });

// ---- crash guard (this feature only; the shake gesture keeps working either way) --------------------------------
// "rendering" is set when the row is first inserted and becomes "ok" after 4s. If the app died in between, that is one
// strike: the feature is skipped for ONE launch, then retried; a second consecutive strike disables it until the
// guard version is bumped. (Before, a single strike - e.g. closing the app within 4s of opening Settings - locked it
// off forever.)
const GUARD_FILE = "settings-guard.json";
const GUARD_VERSION = 7;
type Guard = { v: number; state: string; fails?: number };
const readGuard = () => native.readJSON<Guard | null>(GUARD_FILE, null);
const setGuard = (state: string, fails = 0) => { try { native.writeJSON(GUARD_FILE, { v: GUARD_VERSION, state, fails }); } catch { /* ignore */ } };
const later = (ms: number, fn: () => void) => { if (typeof setTimeout === "function") setTimeout(fn, ms); };

const isPlain = (o: any) => !!o && typeof o === "object" && Object.getPrototypeOf(o) === Object.prototype;
const keyCount = (o: any) => { try { return Object.keys(o).length; } catch { return 0; } };
const asEnum = (): any => { try { return metro.findLoaded((e) => isPlain(e.MobileUserSettings))?.MobileUserSettings; } catch { return undefined; } };

const HBIcon = (props: any) => LogoImage(props);

let entries: Record<string, any> | undefined;
/** Built once, so Discord's navigator always sees the same screen objects / component identities. */
function ourEntries(): Record<string, any> {
  if (entries) return entries;
  const useTitle = () => { rendered = true; return "HeartBlade"; };
  entries = {
    [KEY]: { type: "route", title: () => "HeartBlade", useTitle, IconComponent: HBIcon, withArrow: true, screen: { route: KEY, getComponent: () => RootScreen } },
    // generic sub page (plugins / themes / developer / ...): navigation.push(PAGE_ROUTE, { page, title })
    [PAGE_ROUTE]: { type: "route", title: () => "HeartBlade", useTitle: () => "HeartBlade", IconComponent: HBIcon, screen: { route: PAGE_ROUTE, getComponent: () => PageScreen } },
  };
  return entries;
}

function registerConfig(holder: any) {
  if (registered) return;
  const cfg = holder.SETTING_RENDERER_CONFIG;
  const d = Object.getOwnPropertyDescriptor(holder, "SETTING_RENDERER_CONFIG");
  if (d?.get) return; // already an accessor (ours or somebody else's)
  let original = cfg;
  const ok = Reflect.defineProperty(holder, "SETTING_RENDERER_CONFIG", {
    enumerable: true,
    configurable: true,
    get: () => ({ ...original, ...ourEntries() }),
    set: (v) => { original = v; },
  });
  if (!ok || !holder.SETTING_RENDERER_CONFIG?.[KEY]) { patchErrors.push("config registration not visible"); return; }
  registered = true;
  configKeys = keyCount(cfg);
  lastSample = { desc: d ? { writable: d.writable, configurable: d.configurable } : null };
}

const has = (s: any, ...keys: any[]) => Array.isArray(s?.settings) && keys.some((k) => k !== undefined && s.settings.includes(k));

function onCreateList(args: any[], ret: any) {
  createListCalls++;
  const sections = args[0]?.sections;
  if (!Array.isArray(sections)) return;
  const en = asEnum();
  const account = [en?.ACCOUNT, "ACCOUNT"];
  if (!sections.some((s: any) => has(s, ...account))) return;   // only the settings overview list
  overviewSeen = true;
  const section = { label: "HeartBlade", title: "HeartBlade", settings: [KEY] };
  const place = (arr: any[]) => {
    if (arr.some((s: any) => has(s, KEY))) return false;          // already there
    arr.splice(0, 0, section);                                    // very top of the settings list
    return true;
  };
  if (inserted === 0) {
    setGuard("rendering", readGuard()?.fails ?? 0);
    later(4000, () => { if (readGuard()?.state === "rendering") setGuard("ok", 0); });
  }
  if (place(sections)) inserted++;
  // If createList already copied the sections into its return value, patch that copy too.
  const rs = ret?.sections;
  if (Array.isArray(rs) && rs !== sections) place(rs);
}

function patchCreateList(target: any) {
  if (targets.has(target)) return;
  targets.add(target);
  try {
    after(target, "createList", (args, ret) => { try { onCreateList(args, ret); } catch { /* never break Discord's settings screen */ } return ret; });
    targetCount++;
    log("settings: hooked createList");
  } catch (e: any) {
    patchErrors.push(String(e?.message ?? e).slice(0, 120));
  }
}

function inspect(c: any) {
  if (disabled || c == null || (typeof c !== "object" && typeof c !== "function")) return;
  let fn: any, cfg: any;
  try { fn = c.createList; } catch { fn = undefined; }
  if (typeof fn === "function") patchCreateList(c);
  if (!registered) {
    try { cfg = c.SETTING_RENDERER_CONFIG; } catch { cfg = undefined; }
    if (isPlain(cfg) && keyCount(cfg) >= 50) { try { registerConfig(c); } catch (e: any) { patchErrors.push(String(e?.message ?? e).slice(0, 120)); } }
  }
}

function startListening() {
  if (listening) return;
  listening = true;
  const off = metro.onModuleInit((_id, ex) => {
    for (const c of metro.candidatesOf(ex)) inspect(c);
    if (registered && targetCount > 0 && overviewSeen) off(); // everything is hooked and proven; stop inspecting modules
  });
}

export function installSettingsEntry(): SettingsReport {
  attempts++;
  const report: SettingsReport = {
    builders: targetCount > 0, enumFound: false, configFound: registered, configKeys,
    configRegistered: registered, patched: targetCount > 0, sectionsInserted: inserted, rowRendered: rendered, attempts,
  };
  try {
    if (attempts === 1) {
      const g = readGuard();
      report.guard = g ? `${g.v}:${g.state}:${g.fails ?? 0}` : "none";
      if (g && g.v === GUARD_VERSION) {
        const fails = g.fails ?? 0;
        if (g.state === "rendering") {
          // previous launch died while the row was on screen: strike
          setGuard(fails + 1 >= 2 ? "failed" : "retry", fails + 1);
          if (fails + 1 >= 2) { disabled = true; done = true; warn("settings: disabled after 2 unclean launches; shake still works"); return report; }
          disabled = true; done = true;
          warn("settings: skipped this launch because the previous one did not finish cleanly; will retry next launch");
          return report;
        }
        if (g.state === "failed") { disabled = true; done = true; warn("settings: disabled by crash guard; shake still works"); return report; }
      }
      startListening();
    }

    // scan modules that were initialised before we got here
    metro.forEachLoaded((c) => inspect(c));

    const en = asEnum();
    report.enumFound = !!en && en.ACCOUNT !== undefined;
    report.builders = targetCount > 0;
    report.patched = targetCount > 0;
    report.configFound = registered;
    report.configRegistered = registered;
    report.configKeys = configKeys;
    if (lastSample) report.desc = lastSample.desc;

    if (!registered || targetCount === 0) {
      if (attempts <= 1 || attempts % 15 === 0) warn("settings: waiting for Discord settings modules (will retry; hooks fire on module load)");
    } else {
      if (!done) log("settings: HeartBlade section hooked into the overview list");
      done = true;
    }
  } catch (e: any) {
    report.error = String(e?.message ?? e);
    done = true; // do not retry in a loop; the report says what failed
    warn("settings: failed", report.error);
  }
  report.sectionsInserted = inserted; report.rowRendered = rendered;
  report.createListTargets = targetCount; report.createListCalls = createListCalls; report.overviewSeen = overviewSeen;
  if (patchErrors.length) report.patchErrors = patchErrors.slice(0, 4);
  return report;
}

/** Live counters for the debug report (they change when the settings screen is opened). */
export const settingsStats = () => ({
  registered, patched: targetCount > 0, sectionsInserted: inserted, rowRendered: rendered,
  createListTargets: targetCount, createListCalls, overviewSeen,
});
