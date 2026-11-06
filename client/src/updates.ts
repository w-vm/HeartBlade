import * as native from "./native";
import { BRAND } from "./brand";
import { log } from "./log";
import { getText } from "./manager";
import { alert } from "./ui/kit";

// Client update check: asks GitHub about the latest release and compares it with the client file on this device.
// It only concerns the client itself; plugins are updated separately (Plugins page > Check for updates).
// Nothing is downloaded here; "Update client" (Developer page) does that.
// NOTE: plain Promises on purpose (no async/await), same as manager.ts.

export interface UpdateState {
  phase: "idle" | "checking" | "done" | "error";
  client: boolean;
  error?: string;
}

const STAMP_FILE = "update.json";
const API = BRAND.repo.replace("https://github.com/", "https://api.github.com/repos/") + "/releases/tags/latest";

let state: UpdateState = { phase: "idle", client: false };
const listeners = new Set<() => void>();
const set = (s: UpdateState) => { state = s; for (const l of listeners) { try { l(); } catch { /* ignore */ } } };

export const updateState = () => state;
export const onUpdateState = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export const updatesPending = () => state.client;
export const updateSummary = () => "the client";

interface Asset { size: number; at: string; }
interface Stamp { at?: string; alerted?: string; }
const readStamp = () => native.readJSON<Stamp>(STAMP_FILE, {});

function latestAsset(): Promise<Asset> {
  return getText(API).then((t) => {
    const rel = JSON.parse(t);
    const a = (rel?.assets ?? []).find((x: any) => x?.name === "heartblade.js");
    if (!a) throw new Error("no client in the latest release");
    return { size: Number(a.size) || 0, at: String(a.updated_at ?? "") };
  });
}

/** Size in bytes (UTF-8) of a string: the number GitHub reports for the release file. */
function byteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** Remember which release the installed client came from (called after "Update client"). */
export function markClientCurrent(): Promise<void> {
  return latestAsset().then((a) => { native.writeJSON(STAMP_FILE, { at: a.at }); }, () => { /* the size comparison covers it */ });
}

/**
 * The client is outdated when the client file on this device differs from the one in the latest release.
 * The file's own content decides (its size), not when the release was uploaded, so rebuilding without changes
 * and the app's own automatic download at launch never cause a false "update available".
 */
export function checkUpdates(): Promise<UpdateState> {
  if (state.phase === "checking") return Promise.resolve(state);
  set({ phase: "checking", client: false });
  const dev = !!native.getPrefs()?.devURL;
  return latestAsset().then((a) => {
    const local = native.readFile("bundle.js");
    let client = false;
    if (dev) client = false;                                   // a developer bundle is in use: it is meant to differ
    else if (local) client = byteLength(local) !== a.size;
    else { const stamp = readStamp(); client = !!stamp.at && stamp.at !== a.at; }
    set({ phase: "done", client });
    log(`update check: client ${client ? "has an update" : "is current"}`);
    return state;
  }).catch((e: any) => {
    set({ phase: "error", client: false, error: String(e?.message ?? e) });
    log("update check failed: " + String(e?.message ?? e));
    return state;
  });
}

/** After "Update client": everything is current again. */
export function clearUpdates() { set({ phase: "done", client: false }); }

/** Runs once shortly after Discord starts. Tells you once per release when the client is newer; it never installs anything by itself. */
export function startUpdateCheck() {
  if (typeof setTimeout !== "function") return;
  const devUrl = native.getPrefs()?.devURL;
  if (devUrl) { log("update check skipped: a developer bundle URL is set"); return; }
  setTimeout(() => {
    checkUpdates().then((s) => {
      if (s.phase !== "done" || !s.client) return;
      // Ask only once for a given release (identified by its size), not on every launch.
      latestAsset().then((a) => {
        const stamp = readStamp();
        if (stamp.alerted === String(a.size)) return;
        native.writeJSON(STAMP_FILE, { ...stamp, alerted: String(a.size) });
        alert("HeartBlade update available", "A new version of the client is available.\n\nOpen Settings > HeartBlade > Developer and tap Update client.");
      }, () => { /* offline */ });
    });
  }, 8000);
}
