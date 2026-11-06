// Simulates Hermes + Metro + the native host object to exercise the client end to end.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "hb-"));
const P = (p) => join(dir, p);
mkdirSync(P("plugins/hello"), { recursive: true });
mkdirSync(P("themes"), { recursive: true });
writeFileSync(P("registry.json"), JSON.stringify([
  { type: "plugin", id: "hello", url: "x", enabled: true },
  { type: "theme", id: "crimson", url: "y", enabled: true },
]));
writeFileSync(P("plugins/hello/manifest.json"), JSON.stringify({ name: "Hello" }));
writeFileSync(P("plugins/hello/index.js"), `
  const Dispatcher = hb.flux;
  hb.patcher.after(Dispatcher, "dispatch", (args) => { globalThis.__seen = (globalThis.__seen||0)+1; });
  hb.storage.set("n", 42);
  return { onLoad(){ globalThis.__loaded = true; }, onUnload(){ globalThis.__unloaded = true; } };
`);
writeFileSync(P("themes/crimson.json"), JSON.stringify({ name: "Crimson", semanticColors: { BG: { dark: "#111" }, BACKGROUND_PRIMARY: { dark: "#111" } }, rawColors: { PRIMARY_9: "#222222" } }));

import { existsSync, readFileSync as rf, readdirSync } from "node:fs";
globalThis.__HB_NATIVE__ = {
  version: "test", dir,
  readFile: (p) => (existsSync(P(p)) ? rf(P(p), "utf8") : null),
  writeFile: (p, c) => { mkdirSync(join(P(p), ".."), { recursive: true }); writeFileSync(P(p), c); return true; },
  exists: (p) => existsSync(P(p)),
  listDir: (p) => (existsSync(P(p)) ? readdirSync(P(p)) : []),
  removeFile: () => true,
};

// --- fake Metro ---
const defs = new Map(); const cache = new Map();
globalThis.__r = (id) => {
  if (cache.has(id)) return cache.get(id).exports;
  const module = { exports: {} }; cache.set(id, module);
  defs.get(id)(globalThis, globalThis.__r, null, null, module, module.exports, []);
  return module.exports;
};
// bundle must be evaluated BEFORE __d exists (as in the real app)
(0, eval)(readFileSync(new URL("../dist/heartblade.js", import.meta.url), "utf8"));
globalThis.__d = (factory, id) => defs.set(id, factory);

// Discord registers its modules afterwards
// Shaped like Discord's real colour module: top-level SemanticColor/RawColor, default.{meta,colors,unsafe_rawColors}, token name stored under a Symbol key.
const SYM = Symbol("name");
const BGTOKEN = { [SYM]: "BG" }, BG2TOKEN = { [SYM]: "BG_BASE_PRIMARY" }, RAWTOKEN = { [SYM]: "RAWONLY" };
const color = { SemanticColor: { BG: { dark: { raw: "X", opacity: 1 } }, RAWONLY: { dark: { raw: "PRIMARY_9", opacity: 0.5 } } }, RawColor: { X: "a", PRIMARY_9: "#222222" },
  default: { colors: { BG: BGTOKEN }, meta: { resolveSemanticColor: (t, ref) => "orig" }, unsafe_rawColors: { X: "a" } } };
__d((g, r, i, a, module) => { module.exports = { dispatch() { return "d"; }, subscribe() {}, unsubscribe() {} }; }, 1, []);
__d((g, r, i, a, module) => { module.exports = color; }, 2, []);
__r(1);

await new Promise((r) => setTimeout(r, 400));
assert.equal(globalThis.__loaded, true, "plugin onLoad ran");
const d = __r(1);
d.dispatch(); assert.equal(globalThis.__seen, 1, "after-patch fired");
assert.equal(JSON.parse(readFileSync(P("data/hello.json"), "utf8")).n, 42, "storage persisted");
const R = color.default.meta.resolveSemanticColor;
assert.equal(R("dark", BGTOKEN), "#111", "theme override (token name from Symbol)");
assert.equal(R("darker", BGTOKEN), "#111", "darker/midnight count as dark");
assert.equal(R("light", BGTOKEN), "orig", "light falls through");
assert.equal(R("dark", BG2TOKEN), "#111", "BG_BASE_PRIMARY follows BACKGROUND_PRIMARY-style alt names");
assert.equal(R("dark", RAWTOKEN), "#22222280", "unlisted token resolves through the theme raw palette with opacity");
assert.equal(color.RawColor.PRIMARY_9, "#222222", "raw palette untouched when theme has no raw override for it");
console.log("ALL OK");
process.exit(0);
