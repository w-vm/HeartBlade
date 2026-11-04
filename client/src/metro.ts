// Metro module registry access.
//
// Discord's JS bundle registers modules through the global `__d(factory, id, deps)`.
// Our payload runs *before* that bundle, so we intercept the assignment of `__d`
// and wrap every factory in order to remember each module's `module` object.

interface Entry { mod: any; inited: boolean; }

const registry = new Map<number, Entry>();
const initListeners = new Set<(id: number, exports: any) => void>();
let installed = false;

export function installMetroHook() {
  if (installed) return;
  installed = true;
  const g: any = globalThis;

  const wrapDefine = (realDefine: Function) =>
    function (this: any, factory: Function, id: number, deps: any) {
      if (typeof factory === "function" && !registry.has(id)) {
        const entry: Entry = { mod: undefined, inited: false };
        registry.set(id, entry);
        const wrapped = function (this: any, ...args: any[]) {
          entry.mod = args[4]; // metro passes `module` as the 5th argument
          const out = factory.apply(this, args);
          entry.inited = true;
          if (initListeners.size) {
            for (const l of initListeners) { try { l(id, entry.mod?.exports); } catch { /* ignore */ } }
          }
          return out;
        };
        return realDefine.call(this, wrapped, id, deps);
      }
      return realDefine.call(this, factory, id, deps);
    };

  if (typeof g.__d === "function") {
    g.__d = wrapDefine(g.__d);
    return;
  }
  let current: any;
  Object.defineProperty(g, "__d", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set(v) {
      current = typeof v === "function" ? wrapDefine(v) : v;
    },
  });
}

export const onModuleInit = (cb: (id: number, exports: any) => void) => {
  initListeners.add(cb);
  return () => void initListeners.delete(cb);
};

const requireModule = (id: number) => {
  const r = (globalThis as any).__r;
  return typeof r === "function" ? r(id) : undefined;
};

function* exportsOf(allowInit: boolean): Generator<[number, any]> {
  for (const [id, entry] of registry) {
    if (!entry.inited) {
      if (!allowInit) continue;
      try { requireModule(id); } catch { continue; }
    }
    let ex: any;
    try { ex = entry.mod?.exports; } catch { continue; }
    if (ex == null) continue;
    yield [id, ex];
  }
}

type Filter = (exports: any, id: number) => boolean;

/** Candidates for one module: the exports object itself and its `default`. */
function candidates(ex: any): any[] {
  const out = [ex];
  try { if (ex && typeof ex === "object" && ex.default != null && ex.default !== ex) out.push(ex.default); } catch { /* getter */ }
  return out;
}

function search(filter: Filter, all: boolean, allowInit = true): any[] {
  const hits: any[] = [];
  // Pass 1: already-initialised modules only (cheap, side-effect free).
  // Pass 2: force-init the remainder, in case the module has not been loaded yet.
  for (const pass of allowInit ? [false, true] : [false]) {
    for (const [id, ex] of exportsOf(pass)) {
      for (const c of candidates(ex)) {
        let ok = false;
        try { ok = c != null && filter(c, id); } catch { /* ignore */ }
        if (ok) { hits.push(c); if (!all) return hits; break; }
      }
    }
    if (hits.length) break;
  }
  return hits;
}

export const find = (filter: Filter) => search(filter, false)[0];
export const findAll = (filter: Filter) => search(filter, true);
/** Like find, but never force-initialises modules (safe to poll early). */
export const findAllLoaded = (filter: Filter) => search(filter, true, false);
export const findLoaded = (filter: Filter) => search(filter, false, false)[0];

const has = (o: any, k: string) => { try { return o[k] !== undefined; } catch { return false; } };

export const byProps = (...props: string[]): Filter => (m) => props.every((p) => has(m, p));
export const byName = (name: string): Filter => (m) =>
  m?.name === name || m?.displayName === name || (typeof m === "function" && m.name === name);
export const byStoreName = (name: string): Filter => (m) => typeof m?.getName === "function" && m.getName() === name;

export const findByProps = (...props: string[]) => find(byProps(...props));
export const findByName = (name: string) => find(byName(name));
export const findByStoreName = (name: string) => find(byStoreName(name));

/** Lazy lookup: resolved on first access, handy for use at module top level. */
export function lazy<T = any>(resolver: () => T): () => T {
  let cached: T | undefined;
  let done = false;
  return () => (done ? (cached as T) : ((cached = resolver()), (done = !!cached), cached as T));
}

/** Calls `cb` for every already-initialised module (exports object and its `default`). Never initialises anything. */
export function forEachLoaded(cb: (exports: any, id: number) => void) {
  for (const [id, ex] of exportsOf(false)) for (const c of candidates(ex)) { try { cb(c, id); } catch { /* ignore */ } }
}
export const candidatesOf = candidates;

export const moduleCount = () => registry.size;
