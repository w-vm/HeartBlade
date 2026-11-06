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
let spyOn = false; let spyFilter = ""; let spyCount = 0; const spyUndo: Array<() => void> = [];
const TEXT_PROPS = ["title", "label", "text", "placeholder", "subtitle", "description", "accessibilityLabel", "children", "value", "name", "header", "message"];

function textsOf(p: any): string[] {
  const res: string[] = [];
  if (!p || typeof p !== "object") return res;
  const add = (v: any, depth = 0) => {
    if (typeof v === "string") res.push(v);
    else if (typeof v === "number") res.push(String(v));
    else if (Array.isArray(v) && depth < 2) v.forEach((x) => add(x, depth + 1));
  };
  for (const k of TEXT_PROPS) { try { add(p[k]); } catch { /* getter */ } }
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
    if (!spyFilter) return;
    const f = low(spyFilter);
    const t = textsOf(props).find((s) => low(s).includes(f));
    const nameHit = low(info.name).includes(f);
    if ((t !== undefined || nameHit) && hits.length < 300) hits.push({ el, type, text: t ?? `(component name matches)`, propKeys: keysOf(props).filter((k) => k !== "children").slice(0, 14) });
  } catch { /* never break rendering */ }
}

function patchFactory(holder: any, key: string, jsx: boolean) {
  try {
    spyUndo.push(patcher.after(holder, key, (args, ret) => {
      if (!spyOn) return;
      onElement(args[0], args[1], ret, jsx ? [] : args.slice(2));
    }));
  } catch { /* frozen */ }
}

export function spyStart(filter = "") {
  spyStop(); hits.length = 0; spyCount = 0; spyFilter = filter; spyOn = true;
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
export const spyClear = () => { hits.length = 0; return new Out("cleared"); };

export const dev = {
  modules, props, names, moduleOf, where, get, fns, inspect, store, trace, traces, untrace,
  spy: { start: spyStart, stop: spyStop, results: spyResults, clear: spyClear },
  help: () => new Out([
    "dev.names('Profile')        components/functions by name + their module",
    "dev.modules('note')         modules with a matching export key",
    "dev.props('getToken')       modules exposing ALL these props",
    "dev.fns(1234)               functions of module #1234",
    "dev.inspect(value)          keys/types of any value",
    "dev.store('UserStore')      store methods and fields",
    "dev.where(fn)               module + export of this exact function",
    "dev.trace(obj,'key')        log calls of a method; traces() / untrace()",
    "dev.spy.start('Note')       record rendered UI containing that text",
    "dev.spy.results()           matches, parent chain, module of each",
    "$_                          result of the previous line",
  ].join("\n")),
};
export type Dev = typeof dev;
