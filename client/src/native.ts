// Thin wrapper over the host object the native tweak installs as __HB_NATIVE__.
const n = (): HBNative | undefined => (globalThis as any).__HB_NATIVE__;

export const hasNative = () => !!n();
export const version = () => n()?.version ?? "dev";

export const readFile = (p: string) => n()?.readFile(p) ?? null;
export const writeFile = (p: string, c: string) => !!n()?.writeFile(p, c);
export const exists = (p: string) => !!n()?.exists(p);
export const listDir = (p: string) => n()?.listDir(p) ?? [];
export const removeFile = (p: string) => !!n()?.removeFile(p);

export function readJSON<T>(p: string, fallback: T): T {
  try {
    const raw = readFile(p);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export const writeJSON = (p: string, v: unknown) => writeFile(p, JSON.stringify(v));

export const nativeLog = (line: string) => { try { n()?.log?.(line); } catch { /* ignore */ } };
export const setInfo = (json: string) => { try { n()?.setInfo?.(json); } catch { /* ignore */ } };
export const openPanel = () => { try { n()?.openPanel?.(); } catch { /* ignore */ } };
export const setSettingsEntry = (on: boolean) => { try { n()?.setSettingsEntry?.(on); } catch { /* ignore */ } };

// ---- host functions added in 0.2.0 (optional: an older .deb simply does not provide them) ----
export interface NativePrefs { devURL: string; bundleURL: string; client: boolean; shake: boolean; }
export const hasPrefsApi = () => typeof n()?.getPrefs === "function";
export function getPrefs(): NativePrefs | null {
  try { const raw = n()?.getPrefs?.(); return raw ? (JSON.parse(raw) as NativePrefs) : null; } catch { return null; }
}
export const setPref = (name: string, value: string) => { try { return !!n()?.setPref?.(name, value); } catch { return false; } };
export function getLogs(): string[] {
  try { const raw = n()?.getLogs?.(); return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
}
export const debugReport = (): string => { try { return n()?.debugReport?.() ?? ""; } catch { return ""; } };
export const copyText = (text: string): boolean => { try { if (typeof n()?.copy !== "function") return false; n()!.copy!(text); return true; } catch { return false; } };
export const restartApp = (): boolean => { try { if (typeof n()?.restart !== "function") return false; n()!.restart!(); return true; } catch { return false; } };
