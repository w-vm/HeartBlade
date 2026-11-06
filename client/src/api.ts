import * as metro from "./metro";
import { scoped } from "./patcher";
import * as native from "./native";
import { dev } from "./dev";
import * as kit from "./ui/kit";
import { log, warn, error } from "./log";

/** Per-plugin persistent key/value store backed by <dir>/data/<id>.json */
function makeStorage(id: string) {
  const path = `data/${id}.json`;
  let cache: Record<string, any> | null = null;
  const load = () => (cache ??= native.readJSON<Record<string, any>>(path, {}));
  return {
    get: <T = any>(key: string, fallback?: T): T => { const v = load()[key]; return (v === undefined ? fallback : v) as T; },
    set(key: string, value: any) { load()[key] = value; native.writeJSON(path, cache); },
    remove(key: string) { delete load()[key]; native.writeJSON(path, cache); },
    all: () => ({ ...load() }),
  };
}

const lz = metro.lazy;
const reactNative = lz(() => metro.findByProps("AppRegistry", "Alert"));
const react = lz(() => metro.findByProps("createElement", "useState"));
const flux = lz(() => metro.findByProps("dispatch", "subscribe", "unsubscribe"));

export interface PluginContext {
  id: string;
  /** Dispose hooks run automatically when the plugin is disabled. */
  patcher: ReturnType<typeof scoped>;
  storage: ReturnType<typeof makeStorage>;
}

/** Builds the `hb` object handed to each plugin. */
export function createApi(id: string, name: string) {
  const patcher = scoped();
  const storage = makeStorage(id);
  const tag = `[${name}]`;
  const api = {
    id,
    version: __HB_VERSION__,
    patcher,
    storage,
    dev,
    metro: {
      find: metro.find, findAll: metro.findAll,
      findByProps: metro.findByProps, findByName: metro.findByName, findByStoreName: metro.findByStoreName,
      byProps: metro.byProps, byName: metro.byName, byStoreName: metro.byStoreName,
      onModuleInit: metro.onModuleInit,
    },
    get React() { return react(); },
    get ReactNative() { return reactNative(); },
    get flux() { return flux(); },
    logger: {
      log: (...a: any[]) => log(tag, ...a),
      warn: (...a: any[]) => warn(tag, ...a),
      error: (...a: any[]) => error(tag, ...a),
    },
    ui: {
      alert(title: string, message?: string) { reactNative()?.Alert?.alert(title, message); },
      /** HeartBlade's own building blocks (same look as its pages): Group, Row, SwitchRow, Screen, palette, ... */
      kit,
    },
  };
  return { api, patcher };
}
export type HBApi = ReturnType<typeof createApi>["api"];
