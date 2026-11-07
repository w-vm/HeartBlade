import * as native from "./native";
import { createApi } from "./api";
import { log, error } from "./log";

export interface RegistryEntry {
  type: "plugin" | "theme";
  id: string;
  url: string;
  enabled: boolean;
}
interface Manifest { id?: string; name?: string; version?: string; author?: string; description?: string; }
interface Running { id: string; stop(): void; settings?: any; pages?: Record<string, any>; }

const running = new Map<string, Running>();

export const readRegistry = () => native.readJSON<RegistryEntry[]>("registry.json", []);

function evaluate(source: string, api: any) {
  // Plugins are plain scripts; they receive `hb` and may `return { onLoad, onUnload }`.
  const factory = (0, eval)(`(function(hb){${source}\n})`);
  return factory(api);
}

export function startPlugin(id: string) {
  if (running.has(id)) return;
  const manifest = native.readJSON<Manifest>(`plugins/${id}/manifest.json`, {});
  const source = native.readFile(`plugins/${id}/index.js`);
  if (!source) { error(`plugin ${id}: index.js missing`); return; }

  const { api, patcher } = createApi(id, manifest.name ?? id);
  try {
    const exported = evaluate(source, api) ?? {};
    exported.onLoad?.();
    running.set(id, {
      id,
      // A plugin may return `settings`: a React component that HeartBlade shows on the plugin's own page.
      // `pages`: { name: component } sub pages the settings can open (props.open(name, title)).
      pages: exported.pages && typeof exported.pages === "object" ? exported.pages : undefined,
      settings: typeof exported.settings === "function" || (exported.settings && typeof exported.settings === "object") ? exported.settings : undefined,
      stop() {
        try { exported.onUnload?.(); } catch (e) { error(`plugin ${id}: onUnload`, e); }
        patcher.unpatchAll();
      },
    });
    log(`plugin started: ${manifest.name ?? id}`);
  } catch (e) {
    error(`plugin ${id} failed to start`, e);
    patcher.unpatchAll(); // never leave half-applied patches behind
  }
}

export function stopPlugin(id: string) {
  running.get(id)?.stop();
  running.delete(id);
}

export function startEnabledPlugins() {
  for (const e of readRegistry()) if (e.type === "plugin" && e.enabled) startPlugin(e.id);
}

export const runningPlugins = () => [...running.keys()];
/** The settings component a running plugin exposes (undefined when it has none or is not running). */
export const pluginSettings = (id: string): any => running.get(id)?.settings;
/** A sub page (React component) a running plugin exposes under `pages`. */
export const pluginPage = (id: string, name: string): any => running.get(id)?.pages?.[name];
export const hasPluginSettings = (id: string) => !!pluginSettings(id);
