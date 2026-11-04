import * as metro from "./metro";
import * as native from "./native";
import { log, warn } from "./log";
import { after } from "./patcher";

/**
 * Adds a "HeartBlade" row to the mobile Discord settings screen.
 * Same technique as the Rain client (ra1ncord/rain, plugins/_core/settings/patches/tabs.tsx), verified against
 * Discord 352's bytecode:
 *   1. SETTING_RENDERER_CONFIG (modules/user_settings/core/native/SettingsRendererConfig) maps setting keys to
 *      definitions. It is sealed, so we replace the export with an accessor that returns the original plus our entry.
 *   2. The overview screen calls createList({ sections: [{ label, settings: [keys] }] }) (SettingBuilders). An "after"
 *      hook splices an extra section into that same array.
 * Nothing is modified unless every piece below was found.
 */
export interface SettingsReport {
  builders: boolean; enumFound: boolean; configFound: boolean; configKeys: number;
  configRegistered: boolean; patched: boolean; sectionsInserted: number; rowRendered: boolean;
  attempts: number; error?: string; hint?: any; guard?: string; desc?: any;
}

const KEY = "HEARTBLADE";
let done = false;
let attempts = 0;
let patched = false;
let registered = false;
let inserted = 0;
let rendered = false;

export const settingsDone = () => done;

// Crash guard for this feature only: if a launch that enabled it never reached the "ok" mark, it stays off
// (until a newer client bumps GUARD_VERSION). The shake gesture keeps working either way.
const GUARD_FILE = "settings-guard.json";
const GUARD_VERSION = 5;
const readGuard = () => native.readJSON<{ v: number; state: string } | null>(GUARD_FILE, null);
const setGuard = (state: string) => { try { native.writeJSON(GUARD_FILE, { v: GUARD_VERSION, state }); } catch { /* ignore */ } };
const later = (ms: number, fn: () => void) => { if (typeof setTimeout === "function") setTimeout(fn, ms); };

const isPlain = (o: any) => !!o && typeof o === "object" && Object.getPrototypeOf(o) === Object.prototype;
const keyCount = (o: any) => { try { return Object.keys(o).length; } catch { return 0; } };
const findHolder = () =>
  metro.findAllLoaded((e) => { try { return isPlain(e.SETTING_RENDERER_CONFIG) && keyCount(e.SETTING_RENDERER_CONFIG) >= 50; } catch { return false; } })[0];

export function installSettingsEntry(): SettingsReport {
  const report: SettingsReport = {
    builders: false, enumFound: false, configFound: false, configKeys: 0,
    configRegistered: registered, patched, sectionsInserted: inserted, rowRendered: rendered, attempts: ++attempts,
  };
  try {
    if (attempts === 1) {
      const g = readGuard();
      report.guard = g ? `${g.v}:${g.state}` : "none";
      if (g && g.v === GUARD_VERSION && (g.state === "rendering" || g.state === "failed")) {
        setGuard("failed");
        done = true;
        warn(`settings: disabled because the previous launch did not finish cleanly (${g.state}); shake still works`);
        return report;
      }
    }

    const builders: any = metro.findLoaded((e) => typeof e.createList === "function");
    report.builders = !!builders;
    const en: any = metro.findLoaded((e) => isPlain(e.MobileUserSettings))?.MobileUserSettings;
    report.enumFound = !!en && en.ACCOUNT !== undefined;
    const holder: any = findHolder();
    const cfg: any = holder?.SETTING_RENDERER_CONFIG;
    report.configFound = !!cfg;
    report.configKeys = cfg ? keyCount(cfg) : 0;

    if (!builders || !report.enumFound || !cfg) {
      if (attempts <= 1 || attempts % 15 === 0) warn("settings: waiting for Discord settings modules (will retry)");
      return report;
    }
    if (cfg[en.ACCOUNT] === undefined) {
      report.hint = { sampleConfigKeys: Object.keys(cfg).slice(0, 8), account: String(en.ACCOUNT) };
      done = true;
      warn("settings: config does not contain known keys, row not added (use the shake gesture)");
      return report;
    }

    if (!registered) {
      // Borrow Discord's own icon from a real sibling row; never leave IconComponent undefined.
      const icon: any = cfg[en.ACKNOWLEDGEMENTS]?.IconComponent;
      const entry = {
        type: "pressable",
        IconComponent: typeof icon === "function" ? icon : () => null,
        useTitle: () => { rendered = true; return "HeartBlade"; },
        onPress: () => native.openPanel(),
        withArrow: true,
      };
      const d = Object.getOwnPropertyDescriptor(holder, "SETTING_RENDERER_CONFIG");
      report.desc = d ? { get: !!d.get, set: !!d.set, writable: d.writable, configurable: d.configurable } : null;
      let original = cfg;
      Object.defineProperty(holder, "SETTING_RENDERER_CONFIG", {
        enumerable: true,
        configurable: true,
        get: () => ({ ...original, [KEY]: entry }),
        set: (v) => { original = v; },
      });
      const seen: any = holder.SETTING_RENDERER_CONFIG;
      if (!seen || !seen[KEY]) { done = true; report.hint = { verifyFailed: true }; warn("settings: registration not visible, row not added"); return report; }
      registered = true;
    }

    if (!patched) {
      setGuard("installing");
      later(5000, () => { if (readGuard()?.state === "installing") setGuard("ok"); });
      after(builders, "createList", (args, ret) => {
        try {
          const sections = args[0]?.sections;
          if (!Array.isArray(sections)) return;
          const has = (s: any, k: any) => Array.isArray(s?.settings) && s.settings.includes(k);
          if (!sections.some((s: any) => has(s, en.ACCOUNT))) return;   // only the settings overview list
          if (sections.some((s: any) => has(s, KEY))) return;           // already there
          if (inserted === 0) {
            setGuard("rendering");
            later(4000, () => { if (readGuard()?.state === "rendering") setGuard("ok"); });
          }
          const at = sections.findIndex((s: any) => has(s, en.SUPPORT));
          sections.splice(at >= 0 ? at : sections.length, 0, { label: "HeartBlade", title: "HeartBlade", settings: [KEY] });
          inserted++;
        } catch { /* never break Discord's settings screen */ }
        return ret;
      });
      patched = true;
      log("settings: HeartBlade section hooked into the overview list");
    }
    done = true;
    report.configRegistered = registered; report.patched = patched;
  } catch (e: any) {
    report.error = String(e?.message ?? e);
    done = true; // do not retry in a loop; the report says what failed
    warn("settings: failed", report.error);
  }
  report.sectionsInserted = inserted; report.rowRendered = rendered;
  return report;
}

/** Live counters for the debug report (they change when the settings screen is opened). */
export const settingsStats = () => ({ registered, patched, sectionsInserted: inserted, rowRendered: rendered });
