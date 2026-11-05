import * as native from "./native";
import { BRAND } from "./brand";
import { log } from "./log";
import { getText, listEntries, readMeta } from "./manager";
import { alert } from "./ui/kit";

// Update check: asks GitHub whether the latest release differs from what is installed (client), and whether the
// plugins' own manifests announce a newer version. Nothing is downloaded here; "Update client" (Developer page) does that.
// NOTE: plain Promises on purpose (no async/await), same as manager.ts.

export interface UpdateState {
  phase: "idle" | "checking" | "done" | "error";
  client: boolean;
  plugins: string[];        // names of plugins with a newer version
  error?: string;
}

const STAMP_FILE = "update.json";
const API = BRAND.repo.replace("https://github.com/", "https://api.github.com/repos/") + "/releases/tags/latest";

let state: UpdateState = { phase: "idle", client: false, plugins: [] };
let alerted = false;
const listeners = new Set<() => void>();
const set = (s: UpdateState) => { state = s; for (const l of listeners) { try { l(); } catch { /* ignore */ } } };

export const updateState = () => state;
export const onUpdateState = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export const updatesPending = () => state.client || state.plugins.length > 0;
export const updateSummary = () => [state.client ? "the client" : "", ...state.plugins].filter(Boolean).join(", ");

interface Asset { size: number; at: string; }
function latestAsset(): Promise<Asset> {
  return getText(API).then((t) => {
    const rel = JSON.parse(t);
    const a = (rel?.assets ?? []).find((x: any) => x?.name === "heartblade.js");
    if (!a) throw new Error("no client in the latest release");
    return { size: Number(a.size) || 0, at: String(a.updated_at ?? "") };
  });
}

/** Remember which release the installed client came from (called after "Update client"). */
export function markClientCurrent(): Promise<void> {
  return latestAsset().then((a) => { native.writeJSON(STAMP_FILE, { at: a.at }); }, () => { /* the size comparison covers it */ });
}

function manifestUrl(url: string): string | null {
  const clean = url.split(/[?#]/)[0];
  const last = clean.split("/").pop() ?? "";
  if (last.endsWith(".json")) return url;
  if (last.endsWith(".js")) return null;       // single file plugin: no manifest to compare
  return (url.endsWith("/") ? url : url + "/") + "manifest.json";
}

function checkPlugins(): Promise<string[]> {
  const out: string[] = [];
  let chain: Promise<void> = Promise.resolve();
  for (const e of listEntries("plugin")) {
    const mu = manifestUrl(e.url);
    if (!mu) continue;
    chain = chain.then(() => getText(mu).then((t) => {
      const remote = JSON.parse(t)?.version;
      const m = readMeta("plugin", e.id);
      if (remote && m.version && String(remote) !== String(m.version)) out.push(m.name);
    }, () => { /* offline or no manifest: skip */ }));
  }
  return chain.then(() => out);
}

export function checkUpdates(): Promise<UpdateState> {
  if (state.phase === "checking") return Promise.resolve(state);
  set({ phase: "checking", client: false, plugins: [] });
  return latestAsset().then((a) => {
    const stamp = native.readJSON<{ at?: string } | null>(STAMP_FILE, null);
    const local = native.readFile("bundle.js");
    let client = false;
    if (stamp?.at) client = stamp.at !== a.at;
    else if (local) { client = local.length !== a.size; if (!client) native.writeJSON(STAMP_FILE, { at: a.at }); }
    return checkPlugins().then((plugins) => {
      set({ phase: "done", client, plugins });
      log(`update check: client ${client ? "has an update" : "is current"}, plugins with updates: ${plugins.join(", ") || "none"}`);
      return state;
    });
  }).catch((e: any) => {
    set({ phase: "error", client: false, plugins: [], error: String(e?.message ?? e) });
    log("update check failed: " + String(e?.message ?? e));
    return state;
  });
}

/** After "Update client": everything is current again. */
export function clearUpdates() { set({ phase: "done", client: false, plugins: [] }); }

/** Runs once shortly after Discord starts. Tells you when something is newer; it never installs anything by itself. */
export function startUpdateCheck() {
  if (typeof setTimeout !== "function") return;
  const devUrl = native.getPrefs()?.devURL;
  if (devUrl) { log("update check skipped: a developer bundle URL is set"); return; }
  setTimeout(() => {
    checkUpdates().then((s) => {
      if (s.phase !== "done" || !updatesPending() || alerted) return;
      alerted = true;
      alert("HeartBlade update available", `New version of ${updateSummary()}.\n\nOpen Settings > HeartBlade > Developer and tap Update client.`);
    });
  }, 8000);
}
