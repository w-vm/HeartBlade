import { error } from "./log";
// Minimal method patcher: before / instead / after hooks that can be undone.
type Unpatch = () => void;
type Before = (args: any[]) => any[] | void;
type Instead = (args: any[], orig: (...a: any[]) => any) => any;
type After = (args: any[], ret: any) => any;

interface Slot {
  orig: (...a: any[]) => any;
  before: Set<Before>;
  instead: Set<Instead>;
  after: Set<After>;
}

const slots = new WeakMap<object, Map<string, Slot>>();

function getSlot(obj: any, key: string): Slot {
  let perObj = slots.get(obj);
  if (!perObj) slots.set(obj, (perObj = new Map()));
  let slot = perObj.get(key);
  if (slot) return slot;

  const orig = obj[key];
  if (typeof orig !== "function") throw new TypeError(`patcher: ${key} is not a function`);
  const s: Slot = { orig, before: new Set(), instead: new Set(), after: new Set() };

  const wrapped = function (this: any, ...args: any[]) {
    for (const b of s.before) {
      try { const r = b.call(this, args); if (Array.isArray(r)) args = r; } catch (e) { error("before-patch " + key, e); }
    }
    let call = (...a: any[]) => s.orig.apply(this, a);
    for (const i of s.instead) { const next = call; call = (...a: any[]) => i.call(this, a, next); }
    let ret = call(...args);
    for (const a of s.after) {
      try { const r = a.call(this, args, ret); if (r !== undefined) ret = r; } catch (e) { error("after-patch " + key, e); }
    }
    return ret;
  };
  Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(orig));
  (wrapped as any).__hbOriginal = orig;
  // defineProperty first. A plain `obj[key] = fn` is silently ignored in sloppy
  // mode when Metro/Babel exposed the export as a getter-only accessor, which made the patch look installed but never run.
  let enumerable = true;
  try { enumerable = Object.getOwnPropertyDescriptor(obj, key)?.enumerable ?? true; } catch { /* ignore */ }
  let ok = false;
  try { ok = Reflect.defineProperty(obj, key, { value: wrapped, configurable: true, writable: true, enumerable }); } catch { /* ignore */ }
  if (!ok) { try { obj[key] = wrapped; } catch { /* ignore */ } }
  if (obj[key] !== wrapped) throw new TypeError(`patcher: cannot patch ${key} (property is not configurable)`);
  perObj.set(key, s);
  return s;
}

function add<T>(kind: "before" | "instead" | "after", obj: any, key: string, fn: T): Unpatch {
  const slot = getSlot(obj, key);
  (slot[kind] as Set<T>).add(fn);
  return () => {
    (slot[kind] as Set<T>).delete(fn);
    if (!slot.before.size && !slot.instead.size && !slot.after.size) {
      try { if (!Reflect.defineProperty(obj, key, { value: slot.orig, configurable: true, writable: true, enumerable: true })) obj[key] = slot.orig; } catch { /* frozen */ }
      slots.get(obj)?.delete(key);
    }
  };
}

export const before = (obj: any, key: string, fn: Before) => add("before", obj, key, fn);
export const instead = (obj: any, key: string, fn: Instead) => add("instead", obj, key, fn);
export const after = (obj: any, key: string, fn: After) => add("after", obj, key, fn);

/** Creates a patcher whose patches can all be removed with one call (used per plugin). */
export function scoped() {
  const undo: Unpatch[] = [];
  const track = (u: Unpatch) => (undo.push(u), u);
  return {
    before: (o: any, k: string, f: Before) => track(before(o, k, f)),
    instead: (o: any, k: string, f: Instead) => track(instead(o, k, f)),
    after: (o: any, k: string, f: After) => track(after(o, k, f)),
    unpatchAll() { while (undo.length) { try { undo.pop()!(); } catch { /* ignore */ } } },
  };
}
