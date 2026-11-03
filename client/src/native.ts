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
