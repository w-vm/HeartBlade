import * as metro from "./metro";
import * as native from "./native";

// Discord / device information for the small footer lines on the HeartBlade page.
// Discord + iOS versions come from the native tweak's debug report (already in every .deb that has the settings pages);
// the device model (e.g. iPhone15,4) is read from Discord's own native modules and simply omitted if not found.

const rn = metro.lazy<any>(() => metro.findByProps("AppRegistry", "Alert"));

function nativeModule(...names: string[]): any {
  for (const n of names) {
    try { const v = rn()?.NativeModules?.[n]; if (v) return v; } catch { /* next */ }
    try { const v = (globalThis as any).nativeModuleProxy?.[n]; if (v) return v; } catch { /* next */ }
    try { const t = (globalThis as any).__turboModuleProxy; const v = typeof t === "function" ? t(n) : undefined; if (v) return v; } catch { /* next */ }
  }
  return undefined;
}

function pick(mod: any, ...keys: string[]): string | undefined {
  for (const src of [mod, (() => { try { return mod?.getConstants?.(); } catch { return undefined; } })()]) {
    if (!src) continue;
    for (const k of keys) { try { const v = src[k]; if (typeof v === "string" && v) return v; if (typeof v === "number") return String(v); } catch { /* next */ } }
  }
  return undefined;
}

export interface SysInfo { discord?: string; build?: string; model?: string; os?: string; }
let cached: SysInfo | undefined;

export function sysInfo(): SysInfo {
  if (cached && (cached.discord || cached.os)) return cached;
  const out: SysInfo = {};
  try {
    const rep = native.debugReport();
    const d = /^Discord (\S+) \(([^)]*)\)/m.exec(rep); if (d) { out.discord = d[1]; out.build = d[2]; }
    const o = /^iOS (\S+?),?\s/m.exec(rep); if (o) out.os = o[1];
  } catch { /* ignore */ }
  try {
    if (!out.discord) {
      const info = nativeModule("InfoDictionaryManager", "RTNClientInfoManager", "NativeClientInfoModule");
      out.discord = pick(info, "Version", "version", "CFBundleShortVersionString");
      out.build = pick(info, "Build", "build", "CFBundleVersion");
    }
    const dev = nativeModule("DCDDeviceManager", "RTNDeviceManager", "NativeDeviceModule");
    out.model = pick(dev, "device", "model", "Model", "deviceModel", "machine");
    if (!out.os) out.os = pick(dev, "systemVersion", "osVersion") ?? (() => { try { const v = rn()?.Platform?.Version; return v != null ? String(v) : undefined; } catch { return undefined; } })();
  } catch { /* ignore */ }
  cached = out;
  return out;
}
