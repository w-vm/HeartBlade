// Developer tools for the in-app JS console (also reachable as __hb.dev and hb.dev inside plugins).
// Goal: find *where* things live inside Discord's minified bundle - modules, functions, stores, rendered UI text -
// so a plugin knows exactly what to patch. Everything here is read-only except trace() and spy, which are undoable.
import * as metro from "./metro";
import * as patcher from "./patcher";

/** Plain text result: the console prints it as-is instead of JSON-quoting it. */
export class Out { constructor(public text: string) {} toString() { return this.text; } }
const out = (lines: string[]) => new Out(lines.length ? lines.join("\n") : "(nothing found)");

const own = (o: any, k: string) => { try { const d = Object.getOwnPropertyDescriptor(o, k); return d && "value" in d ? d.value : undefined; } catch { return undefined; } };
const keysOf = (o: any): string[] => { try { return o && (typeof o === "object" || typeof o === "function") ? Object.keys(o) : []; } catch { return []; } };
const low = (s: any) => String(s ?? "").toLowerCase();

export function nameOf(t: any): string {
  try {
    if (t == null) return "null";
    if (typeof t === "string") return t;
    if (typeof t === "function") return t.displayName || t.name || "anonymous";
    if (typeof t === "object") {
      if (t.displayName) return t.displayName;
      const inner = t.type ?? t.render;
      return (t.$$typeof ? (String(t.$$typeof.description ?? "").replace("react.", "") || "wrapped") + ":" : "") + nameOf(inner);
    }
    return String(t);
  } catch { return "?"; }
}

const kind = (v: any) => (v === null ? "null" : Array.isArray(v) ? `array(${v.length})` : typeof v === "function" ? "function" : typeof v);

// ---- modules ----------------------------------------------------------------------------------------------------

/** Loaded modules whose export keys (or component name) contain `query`. */
export function modules(query: string, limit = 40) {
  const q = low(query); const res: string[] = [];
  for (const [id, ex] of metro.loadedEntries()) {
    for (const c of metro.candidatesOf(ex)) {
      const ks = keysOf(c).filter((k) => low(k).includes(q));
      const nm = low(nameOf(c)).includes(q) && typeof c === "function" ? nameOf(c) : "";
      if (ks.length || nm) { res.push(`#${id}  ${nm ? `[${nm}] ` : ""}${ks.slice(0, 8).join(", ")}${ks.length > 8 ? ` …+${ks.length - 8}` : ""}`); break; }
    }
    if (res.length >= limit) break;
  }
  return out(res);
}

/** Modules exposing ALL of the given property names. */
export function props(...names: string[]) {
  const res: string[] = [];
  for (const [id, ex] of metro.loadedEntries()) {
    for (const c of metro.candidatesOf(ex)) {
      if (names.every((n) => own(c, n) !== undefined)) { res.push(`#${id}  ${keysOf(c).slice(0, 14).join(", ")}`); break; }
    }
    if (res.length >= 40) break;
  }
  return out(res);
}

/** Exports (functions / components) whose name or displayName contains `query`, with the module they live in. */
export function names(query: string, limit = 60) {
  const q = low(query); const res: string[] = [];
  for (const [id, ex] of metro.loadedEntries()) {
    const check = (label: string, v: any) => { if ((typeof v === "function" || (v && typeof v === "object" && v.$$typeof)) && low(nameOf(v)).includes(q)) res.push(`#${id}  ${label} -> ${nameOf(v)}`); };
    check("(module)", ex);
    for (const k of keysOf(ex).slice(0, 300)) { const v = own(ex, k); if (v !== undefined) check(k, v); }
    if (res.length >= limit) break;
  }
  return out(res);
}

/** Where does this exact function / component / object live? */
const whereCache = new WeakMap<object, string[]>();
export function moduleOf(value: any): string[] {
  if (value == null || (typeof value !== "object" && typeof value !== "function")) return [];
  const hit = whereCache.get(value); if (hit) return hit;
  const res: string[] = [];
  for (const [id, ex] of metro.loadedEntries()) {
    if (ex === value) { res.push(`#${id} (module)`); continue; }
    for (const k of keysOf(ex).slice(0, 400)) {
      const v = own(ex, k);
      if (v === value || (v && typeof v === "object" && (v.type === value || v.render === value))) { res.push(`#${id} ${k}`); break; }
    }
    if (res.length >= 4) break;
  }
  whereCache.set(value, res);
  return res;
}
export const where = (value: any) => out(moduleOf(value));

export const get = (id: number) => { for (const [i, ex] of metro.loadedEntries()) if (i === id) return ex; return undefined; };
export function fns(id: number) {
  const ex = get(id); if (!ex) return out([`module #${id} is not loaded`]);
  return out(keysOf(ex).map((k) => { const v = own(ex, k); return `${k}: ${kind(v)}${typeof v === "function" ? ` (${v.length} args)` : ""}`; }));
}

/** One-level look inside any value: key, type and a short preview. */
export function inspect(v: any, max = 80) {
  if (v == null || (typeof v !== "object" && typeof v !== "function")) return out([`${kind(v)}: ${String(v)}`]);
  const lines = [`${kind(v)}${typeof v === "function" ? ` ${nameOf(v)}` : ""}  (${keysOf(v).length} keys)`];
  for (const k of keysOf(v).slice(0, max)) {
    const x = own(v, k);
    let prev = x === undefined ? "(getter)" : typeof x === "string" ? JSON.stringify(x.length > 60 ? x.slice(0, 60) + "…" : x) : typeof x === "object" && x ? kind(x) : typeof x === "function" ? `ƒ ${nameOf(x)}` : String(x);
    lines.push(`  ${k}: ${prev}`);
  }
  return out(lines);
}

/** A Flux store by name, its methods and (own) state keys. */
export function store(name: string) {
  const s = metro.findByStoreName(name);
  if (!s) return out([`no store named "${name}"`]);
  const methods: string[] = []; const state: string[] = [];
  let o: any = s;
  for (let d = 0; o && d < 3; d++, o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) { const v = own(o, k); (typeof v === "function" ? methods : state).push(k); }
  return out([`store ${name}`, `methods: ${[...new Set(methods)].filter((k) => k !== "constructor").join(", ")}`, `fields: ${[...new Set(state)].join(", ")}`]);
}

// ---- call tracing -----------------------------------------------------------------------------------------------

const traceLog: string[] = [];
const traceUndo: Array<() => void> = [];
const brief = (a: any): string => { try { if (a == null) return String(a); if (typeof a === "string") return JSON.stringify(a.length > 40 ? a.slice(0, 40) + "…" : a); if (typeof a === "function") return "ƒ"; if (typeof a === "object") return Array.isArray(a) ? `[${a.length}]` : `{${keysOf(a).slice(0, 4).join(",")}}`; return String(a); } catch { return "?"; } };

/** Logs every call of obj[key] (arguments are summarised, never mutated). Read the result with traces(). */
export function trace(obj: any, key: string, label = key) {
  const undo = patcher.before(obj, key, (args) => { if (traceLog.length < 400) traceLog.push(`${label}(${args.slice(0, 4).map(brief).join(", ")})`); });
  traceUndo.push(undo);
  return new Out(`tracing ${label}; call traces() to read, untrace() to stop`);
}
export const traces = () => out(traceLog.slice());
export function untrace() { while (traceUndo.length) { try { traceUndo.pop()!(); } catch { /* ignore */ } } traceLog.length = 0; return new Out("all traces removed"); }

// ---- UI spy -----------------------------------------------------------------------------------------------------
// Records React elements as they are created. Text and props are matched against a filter, and because children are
// created before their parents, parent links let us report "this text sits inside <A> inside <B> inside <C>" together
// with the module each component lives in.

interface Hit { el: any; type: any; text: string; propKeys: string[]; }
interface Info { name: string; type: any; el: any; }
const parentOf = new WeakMap<object, Info>();
const hits: Hit[] = [];
const seenTexts = new Map<string, { n: number; by: string }>();
let muted = false; let spyOn = false; let spyFilter = ""; let spyCount = 0; const spyUndo: Array<() => void> = [];
const SKIP_PROPS = new Set(["style", "source", "key", "ref", "testID", "nativeID", "onPress", "onLayout", "hitSlop", "contentContainerStyle"]);

/** Every short string reachable from props (plain objects / arrays up to 4 levels, never functions or elements). */
function textsOf(p: any): string[] {
  const res: string[] = [];
  if (!p || typeof p !== "object") return res;
  const seen = new Set<any>();
  const add = (v: any, depth: number) => {
    if (res.length >= 40) return;
    if (typeof v === "string") { if (v.length >= 1 && v.length <= 300) res.push(v); return; }
    if (typeof v === "number") { res.push(String(v)); return; }
    if (!v || typeof v !== "object" || depth > 4 || seen.has(v) || v.$$typeof) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v.slice(0, 30)) add(x, depth + 1); return; }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return;
    for (const k of Object.keys(v).slice(0, 30)) { if (SKIP_PROPS.has(k)) continue; const d = Object.getOwnPropertyDescriptor(v, k); if (d && "value" in d) add(d.value, depth + 1); }
  };
  add(p, 0);
  return res;
}
function childEls(p: any, extra: any[] = []): any[] {
  const res: any[] = [];
  const walk = (v: any, d = 0) => { if (v && typeof v === "object") { if (Array.isArray(v)) { if (d < 3) v.forEach((x) => walk(x, d + 1)); } else if (v.$$typeof) res.push(v); } };
  try { walk(p?.children); } catch { /* ignore */ }
  extra.forEach((x) => walk(x));
  return res;
}

function onElement(type: any, props: any, el: any, extraChildren: any[] = []) {
  try {
    if (!el || typeof el !== "object") return;
    spyCount++;
    props = el.props ?? props; // the finished element already has children merged in
    const info: Info = { name: nameOf(type), type, el };
    for (const c of childEls(props, extraChildren)) parentOf.set(c, info);
    const all = textsOf(props);
    for (const x of all) { if (x.length < 2 || x.length > 120) continue; const r = seenTexts.get(x); if (r) r.n++; else if (seenTexts.size < 4000) seenTexts.set(x, { n: 1, by: info.name }); }
    if (!spyFilter) return;
    const f = low(spyFilter);
    const t = all.find((s) => low(s).includes(f));
    const nameHit = low(info.name).includes(f);
    if ((t !== undefined || nameHit) && hits.length < 300) hits.push({ el, type, text: t ?? `(component name matches)`, propKeys: keysOf(props).filter((k) => k !== "children").slice(0, 14) });
  } catch { /* never break rendering */ }
}

function patchFactory(holder: any, key: string, jsx: boolean) {
  try {
    spyUndo.push(patcher.after(holder, key, (args, ret) => {
      if (!spyOn || muted) return;
      onElement(args[0], args[1], ret, jsx ? [] : args.slice(2));
    }));
  } catch { /* frozen */ }
}

export function spyStart(filter = "") {
  spyStop(); muted = false; hits.length = 0; spyCount = 0; seenTexts.clear(); spyFilter = filter; spyOn = true;
  const R = metro.findByProps("createElement", "useState");
  if (R) patchFactory(R, "createElement", false);
  for (const m of metro.findAllLoaded((e) => { try { return typeof e.jsx === "function" || typeof e.jsxs === "function" || typeof e.jsxDEV === "function"; } catch { return false; } }).slice(0, 4))
    for (const k of ["jsx", "jsxs", "jsxDEV"]) if (typeof own(m, k) === "function") patchFactory(m, k, true);
  return new Out(`UI spy recording${filter ? ` for "${filter}"` : ""}. Open or refresh the screen you care about (pull to refresh, switch tabs), then run spyResults().`);
}
export function spyStop() { spyOn = false; while (spyUndo.length) { try { spyUndo.pop()!(); } catch { /* ignore */ } } }

/** Matches with their parent chain and where each component lives. Safe to call while recording. */
export function spyResults(max = 25) {
  const seen = new Set<string>(); const lines: string[] = [`${spyOn ? "recording" : "stopped"} · filter "${spyFilter}" · ${spyCount} elements seen · ${hits.length} matches`];
  for (const h of hits) {
    const chain: Info[] = []; let cur: any = h.el;
    for (let i = 0; i < 8; i++) { const p = parentOf.get(cur); if (!p) break; chain.push(p); cur = p.el; if (!cur) break; }
    const own1 = nameOf(h.type);
    const key = own1 + "|" + h.text + "|" + chain.map((c) => c.name).join("<");
    if (seen.has(key)) continue; seen.add(key);
    const loc = (t: any) => (typeof t === "string" ? "" : ` ${moduleOf(t)[0] ?? "(module unknown)"}`);
    lines.push("", `"${h.text.slice(0, 60)}"`, `  element: <${own1}>${loc(h.type)}  props: ${h.propKeys.join(", ")}`);
    if (chain.length) lines.push(`  parent:  ${chain.map((c) => `<${c.name}>${loc(c.type)}`).join("\n         < ")}`);
    if (seen.size >= max) break;
  }
  return new Out(lines.join("\n"));
}
/** Every distinct text the spy saw (optionally filtered) and which component drew it. Use it to learn what the screen really contains. */
export function spyTexts(query = "", max = 80) {
  const q = low(query); const lines: string[] = [];
  for (const [t, r] of seenTexts) { if (q && !low(t).includes(q)) continue; lines.push(`${String(r.n).padStart(4)}x  "${t.length > 70 ? t.slice(0, 70) + "…" : t}"  <${r.by}>`); if (lines.length >= max) break; }
  return new Out(lines.length ? `${seenTexts.size} distinct texts seen\n` + lines.join("\n") : `${seenTexts.size} distinct texts seen, none match "${query}"`);
}
export const spyMute = (on: boolean) => { muted = on; };
export const spyClear = () => { hits.length = 0; return new Out("cleared"); };

// ---- React fiber tree ------------------------------------------------------------------------------------------
// The element-creation spy only sees code that calls the React functions we patch. Discord's own screens may not, so we
// also keep a minimal React DevTools hook: React hands it every committed root, and from a root we can read the whole
// rendered tree (components, props, parents) no matter how the elements were created. It must be installed before React
// starts, i.e. from the first lines of index.ts. It only stores the roots; it never changes what React does.
const roots = new Map<number, any>();
export function installFiberHook() {
  const g: any = globalThis;
  if (g.__REACT_DEVTOOLS_GLOBAL_HOOK__) return false;
  let n = 0;
  const hook = {
    supportsFiber: true, isDisabled: false, renderers: new Map<number, any>(),
    inject(r: any) { const id = ++n; hook.renderers.set(id, r); return id; },
    onCommitFiberRoot(id: number, root: any) { roots.set(id, root); },
    onPostCommitFiberRoot() {}, onCommitFiberUnmount() {}, setStrictMode() {}, checkDCE() {},
    sub() { return () => {}; }, on() {}, off() {}, emit() {},
  };
  try { Object.defineProperty(g, "__REACT_DEVTOOLS_GLOBAL_HOOK__", { value: hook, configurable: true, writable: true }); return true; } catch { return false; }
}

const COMPOSITE = new Set([0, 1, 11, 14, 15]);
function eachFiber(fn: (f: any) => void, cap = 300000) {
  let seen = 0;
  for (const root of roots.values()) {
    const stack: any[] = [root.current];
    while (stack.length && seen < cap) {
      const f = stack.pop(); if (!f) continue; seen++;
      try { fn(f); } catch { /* ignore */ }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
  }
  return seen;
}
const countKids = (f: any) => { let n = 0; for (let c = f?.child; c; c = c.sibling) n++; return n; };
const indexIn = (f: any) => { let i = 0; for (let c = f?.return?.child; c; c = c.sibling, i++) if (c === f) return i; return -1; };

/** Find rendered text anywhere in the app: which components draw it, where they live and where it sits among siblings. */
export function treeFind(query: string, max = 12) {
  if (!roots.size) return new Out("No React root captured yet. Interact with the app once (open a screen), then try again. If it stays empty, the hook was installed too late: restart Discord.");
  const q = low(query); const lines: string[] = []; const seen = new Set<string>(); let hitsN = 0;
  const total = eachFiber((f) => {
    let text: string | undefined;
    if (f.tag === 6 && typeof f.memoizedProps === "string" && low(f.memoizedProps).includes(q)) text = f.memoizedProps;
    else if (COMPOSITE.has(f.tag)) text = textsOf(f.memoizedProps).find((t) => low(t).includes(q));
    if (text === undefined || hitsN >= max) return;
    const chain: string[] = [];
    let cur = f.return; let hops = 0;
    for (; cur && chain.length < 9 && hops < 60; cur = cur.return, hops++) {
      if (!COMPOSITE.has(cur.tag)) continue;
      const loc = moduleOf(cur.type)[0] ?? "(module unknown)";
      chain.push(`<${nameOf(cur.type)}> ${loc}  props: ${keysOf(cur.memoizedProps).filter((k) => k !== "children").slice(0, 8).join(", ")}  [child ${indexIn(cur)} of ${countKids(cur.return)}]`);
    }
    const self = COMPOSITE.has(f.tag) ? `<${nameOf(f.type)}> ${moduleOf(f.type)[0] ?? "(module unknown)"}  [child ${indexIn(f)} of ${countKids(f.return)}]` : "(text node)";
    const key = text + "|" + self + "|" + chain.join(">");
    if (seen.has(key)) return; seen.add(key); hitsN++;
    lines.push("", `"${text.slice(0, 70)}"`, `  drawn by: ${self}`, ...chain.map((c, i) => `  ${i === 0 ? "inside:  " : "  <      "}${c}`));
  });
  return new Out([`${roots.size} root(s), ${total} fibers scanned, ${hitsN} match(es) for "${query}"`, ...lines].join("\n"));
}
export const tree = { find: treeFind, roots: () => roots.size };

export const dev = {
  modules, props, names, moduleOf, where, get, fns, inspect, store, trace, traces, untrace,
  tree,
  spy: { start: spyStart, stop: spyStop, results: spyResults, clear: spyClear, mute: spyMute, texts: spyTexts },
  help: () => new Out([
    "dev.names('Profile')        components/functions by name + their module",
    "dev.modules('note')         modules with a matching export key",
    "dev.props('getToken')       modules exposing ALL these props",
    "dev.fns(1234)               functions of module #1234",
    "dev.inspect(value)          keys/types of any value",
    "dev.store('UserStore')      store methods and fields",
    "dev.where(fn)               module + export of this exact function",
    "dev.trace(obj,'key')        log calls of a method; traces() / untrace()",
    "dev.tree.find('Note')       find rendered text anywhere on screen + its components (best tool)",
    "dev.spy.start('Note')       record rendered UI containing that text",
    "dev.spy.results()           matches, parent chain, module of each",
    "dev.spy.texts('edit')        every text the spy saw (learn what the screen contains)",
    "$_                          result of the previous line",
  ].join("\n")),
};
export type Dev = typeof dev;
