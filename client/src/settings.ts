import * as metro from "./metro";
import * as native from "./native";
import { log, warn } from "./log";
import { before } from "./patcher";

/**
 * Adds a "HeartBlade" row to the mobile Discord settings screen (verified against Discord 352 bytecode).
 *
 * How Discord builds that screen:
 *   modules/user_settings/overview/native/SettingsOverviewScreen.tsx
 *     getOverviewSettings() -> [{ label, settings: [MobileUserSettings.X, ...] }, ...]
 *     createList({ sections })            (modules/settings/native/renderer/SettingBuilders.tsx)
 *   modules/user_settings/core/native/SettingsRendererConfig.tsx
 *     SETTING_RENDERER_CONFIG = { [MobileUserSettings.X]: createPressable({ useTitle, IconComponent, onPress, ... }), ... }
 *
 * So we (1) register a pressable under our own key in SETTING_RENDERER_CONFIG and
 * (2) wrap createList so the overview call gets an extra section that lists that key.
 * Nothing is modified unless every piece below was found and validated.
 */
export interface SettingsReport {
  builders: boolean; enumFound: boolean; configFound: boolean; configKeys: number; iconFound: boolean;
  configRegistered: boolean; patched: boolean; sectionsInserted: number; rowRendered: boolean;
  attempts: number; error?: string; hint?: any;
}

const KEY = "HEARTBLADE";
let done = false;
let attempts = 0;
let patched = false;
let registered = false;
let inserted = 0;
let rendered = false;

export const settingsDone = () => done;

const isPlain = (o: any) => !!o && typeof o === "object" && Object.getPrototypeOf(o) === Object.prototype;
const keyCount = (o: any) => { try { return Object.keys(o).length; } catch { return 0; } };

export function installSettingsEntry(): SettingsReport {
  const report: SettingsReport = {
    builders: false, enumFound: false, configFound: false, configKeys: 0, iconFound: false,
    configRegistered: registered, patched, sectionsInserted: inserted, rowRendered: rendered, attempts: ++attempts,
  };
  try {
    const builders: any = metro.findLoaded((e) => typeof e.createPressable === "function" && typeof e.createList === "function");
    report.builders = !!builders;

    const en: any = metro.findLoaded((e) => isPlain(e.MobileUserSettings))?.MobileUserSettings;
    report.enumFound = !!en && en.ACCOUNT !== undefined;

    // The real config is a plain object with many entries (a different module also exports a same-named i18n message).
    const cfg: any = metro.findAllLoaded((e) => { try { return isPlain(e.SETTING_RENDERER_CONFIG) && keyCount(e.SETTING_RENDERER_CONFIG) >= 50; } catch { return false; } })[0]?.SETTING_RENDERER_CONFIG;
    report.configFound = !!cfg;
    report.configKeys = cfg ? keyCount(cfg) : 0;

    const icon: any = metro.findLoaded((e) => e.CircleInformationIcon !== undefined)?.CircleInformationIcon;
    report.iconFound = !!icon;

    if (!builders || !report.enumFound || !cfg) {
      if (attempts <= 1 || attempts % 15 === 0) warn("settings: waiting for Discord settings modules (will retry)");
      return report;
    }
    if (cfg[en.ACCOUNT] === undefined) {
      // Not the config we think it is: do not touch anything.
      report.hint = { sampleConfigKeys: Object.keys(cfg).slice(0, 8), account: String(en.ACCOUNT) };
      done = true;
      warn("settings: config does not contain known keys, row not added (use the shake gesture)");
      return report;
    }

    if (!registered) {
      cfg[KEY] = builders.createPressable({
        useTitle: () => { rendered = true; return "HeartBlade"; },
        ...(icon ? { IconComponent: icon } : {}),
        onPress: () => native.openPanel(),
        withArrow: true,
      });
      registered = true;
    }

    if (!patched) {
      before(builders, "createList", (args) => {
        try {
          const opts = args[0];
          const secs = opts?.sections;
          if (!Array.isArray(secs)) return;
          const has = (s: any, k: any) => Array.isArray(s?.settings) && s.settings.includes(k);
          if (!secs.some((s: any) => has(s, en.ACCOUNT))) return;   // only the settings overview list
          if (secs.some((s: any) => has(s, KEY))) return;           // already there
          const next = secs.slice();
          const at = next.findIndex((s: any) => has(s, en.SUPPORT));
          next.splice(at >= 0 ? at : next.length, 0, { label: "HeartBlade", settings: [KEY] });
          inserted++;
          return [{ ...opts, sections: next }, ...args.slice(1)];
        } catch { /* never break Discord's settings screen */ }
      });
      patched = true;
      log("settings: HeartBlade section hooked into the overview list");
    }
    done = true;
    report.configRegistered = registered; report.patched = patched;
  } catch (e: any) {
    report.error = String(e?.message ?? e);
    warn("settings: failed", report.error);
  }
  report.sectionsInserted = inserted; report.rowRendered = rendered;
  return report;
}

/** Live counters for the debug report (they change when the settings screen is opened). */
export const settingsStats = () => ({ registered, patched, sectionsInserted: inserted, rowRendered: rendered });
