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
interface Running { id: string; stop(): void; }

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
