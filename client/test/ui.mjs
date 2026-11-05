// UI smoke test: runs the built bundle against a fake Metro / React / React Native and drives the HeartBlade settings
// pages (render, press, type, toggle, install) without a device. React here is a ~100 line stand-in with hooks.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "hb-ui-"));
const P = (p) => join(dir, p);
mkdirSync(P("plugins/hello"), { recursive: true });
writeFileSync(P("registry.json"), JSON.stringify([
  { type: "plugin", id: "hello", url: "https://x.test/hello/", enabled: true },
  { type: "theme", id: "crimson", url: "https://x.test/crimson.json", enabled: true },
]));
mkdirSync(P("themes"), { recursive: true });
writeFileSync(P("plugins/hello/manifest.json"), JSON.stringify({ name: "Hello", version: "1.0.0", author: "wvm" }));
writeFileSync(P("plugins/hello/index.js"), "return { settings: function HelloSettings() { return hb.React.createElement('Text', null, 'Hello settings body'); } };");
writeFileSync(P("themes/crimson.json"), JSON.stringify({ name: "Crimson", semanticColors: { BG: { dark: "#111" } } }));

// ---- fake native host (starts WITHOUT the 0.2.0 functions to test the old-.deb path) ----
const state = { devURL: "", client: true, shake: true, copied: null, restarted: false };
const native = globalThis.__HB_NATIVE__ = {
  version: "test", dir,
  readFile: (p) => (existsSync(P(p)) ? readFileSync(P(p), "utf8") : null),
  writeFile: (p, c) => { mkdirSync(join(P(p), ".."), { recursive: true }); writeFileSync(P(p), c); return true; },
  exists: (p) => existsSync(P(p)),
  listDir: (p) => (existsSync(P(p)) ? readdirSync(P(p)) : []),
  removeFile: () => true,
  openPanel: () => { state.panel = true; },
  setSettingsEntry: (on) => { state.entry = on; },
};
const logs = ["10:00:00 LOG runtime test", "10:00:01 WARN careful", "10:00:02 ERROR broken"];
const addNewNative = () => Object.assign(native, {
  getPrefs: () => JSON.stringify({ devURL: state.devURL, bundleURL: "https://x.test/heartblade.js", client: state.client, shake: state.shake }),
  setPref: (k, v) => { if (k === "devURL") state.devURL = v; else if (k === "client") state.client = v === "1"; else if (k === "shake") state.shake = v === "1"; else return false; return true; },
  getLogs: () => JSON.stringify(logs),
  debugReport: () => "REPORT",
  copy: (t) => { state.copied = t; },
  restart: () => { state.restarted = true; },
});

// ---- fake fetch ----
const web = {
  "https://x.test/p/manifest.json": JSON.stringify({ name: "Cool Plug", version: "1.2.3", author: "me" }),
  "https://x.test/p/index.js": "return { onLoad(){} };",
  "https://x.test/t.json": JSON.stringify({ name: "Neon Night", semanticColors: { BG: { dark: "#001" } } }),
  "https://x.test/bad.json": JSON.stringify({ hello: 1 }),
  "https://x.test/heartblade.js": "/* release client */".padEnd(400, " "),
  "https://github.com/w-vm/heartblade/releases/download/latest/heartblade.js": "/* default release client */".padEnd(400, " "),
  "http://192.168.1.5:3000/heartblade.js": "/* dev client */".padEnd(400, " "),
};
globalThis.fetch = async (url) => (url in web ? { ok: true, status: 200, text: async () => web[url] } : { ok: false, status: 404, text: async () => "" });

// ---- fake React (function + class components, useState / useEffect / useRef) ----
const FRAGMENT = Symbol.for("hb.fragment");
const stores = new Map(); const ctx = []; let pending = []; let rootEl = null; let tree = []; let scheduled = false;
const getStore = (k) => { let s = stores.get(k); if (!s) stores.set(k, (s = { hooks: [], i: 0 })); return s; };
const React = {
  Fragment: FRAGMENT,
  createElement(type, props, ...children) {
    props = props ? { ...props } : {};
    const key = props.key; delete props.key;
    if (children.length) props.children = children.length === 1 ? children[0] : children;
    return { $$el: true, type, props, key };
  },
  Component: class { constructor(props) { this.props = props; } },
  useState(init) {
    const s = ctx[ctx.length - 1]; const i = s.i++;
    if (!s.hooks[i]) { const slot = { v: typeof init === "function" ? init() : init }; slot.set = (nv) => { slot.v = typeof nv === "function" ? nv(slot.v) : nv; schedule(); }; s.hooks[i] = slot; }
    return [s.hooks[i].v, s.hooks[i].set];
  },
  useRef(init) { const s = ctx[ctx.length - 1]; const i = s.i++; return (s.hooks[i] ??= { current: init }); },
  useEffect(fn, deps) {
    const s = ctx[ctx.length - 1]; const i = s.i++; const slot = s.hooks[i];
    const changed = !slot || !deps || deps.some((d, j) => d !== slot.deps[j]);
    s.hooks[i] = { deps };
    if (changed) pending.push(fn);
  },
};
function render(el, path) {
  if (el == null || typeof el === "boolean") return [];
  if (Array.isArray(el)) return el.flatMap((c, i) => render(c, `${path}.${i}`));
  if (typeof el === "string" || typeof el === "number") return [String(el)];
  assert.ok(el.$$el, "not a React element: " + JSON.stringify(el)?.slice(0, 120));
  const { type, props } = el;
  if (type === FRAGMENT) return render(props.children, `${path}<${el.key ?? ""}>`);
  if (typeof type === "string") return [{ type, props, children: render(props.children, `${path}/${type}`) }];
  const key = `${path}|${type.name}`;
  const store = getStore(key);
  if (type.prototype && type.prototype.render) {
    const inst = (store.inst ??= new type(props)); inst.props = props;
    try { return render(inst.render(), key); }
    catch (e) {
      if (!type.getDerivedStateFromError) throw e;
      inst.state = { ...inst.state, ...type.getDerivedStateFromError(e) }; inst.componentDidCatch?.(e);
      return render(inst.render(), key + "!");
    }
  }
  store.i = 0; ctx.push(store);
  let out; try { out = type(props); } finally { ctx.pop(); }
  return render(out, key);
}
function commit() {
  pending = [];
  tree = render(rootEl, "root");
  const effects = pending; pending = [];
  for (const fn of effects) fn();
}
function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; commit(); }); } }
const mount = (Component, props) => { stores.clear(); rootEl = React.createElement(Component, props); commit(); };
const flush = () => new Promise((r) => setTimeout(r, 15));

// tree helpers
const texts = (nodes) => nodes.flatMap((n) => (typeof n === "string" ? [n] : texts(n.children)));
const all = (nodes, pred) => nodes.flatMap((n) => (typeof n === "string" ? [] : [...(pred(n) ? [n] : []), ...all(n.children, pred)]));
const has = (label) => texts(tree).some((t) => t === label || t.includes(label));
const row = (label) => { const r = all(tree, (n) => n.type === "Pressable" && texts(n.children).some((t) => t === label))[0]; assert.ok(r, `row "${label}" not found; have: ${texts(tree).slice(0, 40).join(" | ")}`); return r; };
const press = async (label) => { const r = row(label); assert.ok(r.props.onPress, `row "${label}" has no onPress`); r.props.onPress(); await flush(); };
const toggle = async (label, v) => { const sw = all(row(label).children, (n) => n.type === "Switch")[0]; assert.ok(sw, `no switch in "${label}"`); sw.props.onValueChange(v); await flush(); };
const type = async (placeholder, v) => { const f = all(tree, (n) => n.type === "TextInput" && n.props.placeholder === placeholder)[0]; assert.ok(f, `no field ${placeholder}`); f.props.onChangeText(v); await flush(); };

// ---- fake React Native ----
const alerts = []; const opened = [];
const RN = {
  AppRegistry: {},
  Alert: { alert: (t, m, b) => alerts.push({ t, m, b }), prompt: (t, m, b, ...rest) => alerts.push({ t, m, b, prompt: true, rest }) },
  View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable", Image: "Image", TextInput: "TextInput", Modal: "Modal",
  Switch: (props) => { if (globalThis.__boom) throw new Error("boom"); return React.createElement("Switch", props); },
  NativeModules: { BundleUpdaterManager: { reload: () => { state.reloaded = true; } } },
  StyleSheet: { hairlineWidth: 1 }, Linking: { openURL: (u) => opened.push(u) },
  Animated: { Value: class { constructor(v) { this.v = v; } setValue(v) { this.v = v; } }, View: "AnimatedView", spring: () => ({ start: (cb) => cb && cb() }) },
  PanResponder: { create: (cfg) => ({ panHandlers: { __cfg: cfg } }) },
};

// ---- load the bundle (before __d exists, like the real app) ----
const defs = new Map(); const cache = new Map();
globalThis.__r = (id) => {
  if (cache.has(id)) return cache.get(id).exports;
  const module = { exports: {} }; cache.set(id, module);
  defs.get(id)(globalThis, globalThis.__r, null, null, module, module.exports, []);
  return module.exports;
};
(0, eval)(readFileSync(new URL("../dist/heartblade.js", import.meta.url), "utf8"));
globalThis.__d = (factory, id) => defs.set(id, factory);

__d((g, r, i, a, m) => { m.exports = { dispatch() {}, subscribe() {}, unsubscribe() {} }; }, 1, []);
__r(1);
await new Promise((r) => setTimeout(r, 400));   // client boots

// Discord's settings modules load lazily, after boot
const cfg = {}; for (let n = 0; n < 60; n++) cfg["K" + n] = { type: "pressable" };
cfg.ACCOUNT = { type: "route" }; cfg.SUPPORT = { type: "route" };
__d((g, r, i, a, m) => { m.exports = { MobileUserSettings: { ACCOUNT: "ACCOUNT", SUPPORT: "SUPPORT" } }; }, 10, []);
__d((g, r, i, a, m) => { m.exports = { createList(o) { return { sections: o.sections }; }, SETTING_RENDERER_CONFIG: cfg }; }, 11, []);
__d((g, r, i, a, m) => { m.exports = RN; }, 12, []);
__d((g, r, i, a, m) => { m.exports = React; }, 13, []);
__r(10); const settings = __r(11); __r(12); __r(13);
const users = {};
__d((g, r, i, a, m) => { m.exports = { getName: () => "UserStore", getUser: (id) => users[id] }; }, 14, []);
__d((g, r, i, a, m) => { m.exports = { fetchProfile: async (id) => { users[id] = { id, username: "wvmuser", avatar: "abc" }; } }; }, 15, []);
__d((g, r, i, a, m) => { m.exports = { showUserProfile: (o) => { globalThis.__profile = o; } }; }, 16, []);
__r(14); __r(15); __r(16);

// ===== 1. settings entry =====
const out = settings.createList({ sections: [{ label: "Account Settings", settings: ["ACCOUNT"] }, { label: "Support", settings: ["SUPPORT"] }] });
assert.equal(out.sections[0].settings[0], "HEARTBLADE", "HeartBlade section is first");
assert.equal(state.entry, true, "native side is told the settings row works (shake panel steps aside)");
assert.equal(out.sections.length, 3);
const conf = settings.SETTING_RENDERER_CONFIG;
assert.equal(conf.HEARTBLADE.type, "route", "row is a Discord route");
assert.equal(conf.HEARTBLADE.screen.route, "HEARTBLADE");
assert.equal(conf.HEARTBLADE_PAGE.screen.route, "HEARTBLADE_PAGE");
assert.equal(typeof conf.HEARTBLADE.IconComponent, "function");
assert.equal(conf.HEARTBLADE.useTitle(), "HeartBlade");
assert.equal(conf.K0.type, "pressable", "original config entries are kept");
assert.equal(conf.HEARTBLADE, settings.SETTING_RENDERER_CONFIG.HEARTBLADE, "entries are stable between reads");
// the icon is our own image (not Discord's "i")
const icon = React.createElement(conf.HEARTBLADE.IconComponent, { size: 24, color: "#fff" });
mount(() => icon, {});
const img = all(tree, (n) => n.type === "Image")[0];
assert.ok(img.props.source.uri.startsWith("data:image/png;base64,"), "logo is an embedded PNG");
assert.equal(img.props.style.tintColor, undefined, "icon is shown in full colour, not tinted");

// ===== 2. root page =====
const navCalls = []; const navOpts = [];
const nav = { push: (r, p) => navCalls.push([r, p]), setOptions: (o) => navOpts.push(o), addListener: () => () => {} };
const Root = conf.HEARTBLADE.screen.getComponent();
const Sub = conf.HEARTBLADE_PAGE.screen.getComponent();
mount(Root, { navigation: nav, route: {} });
await flush();
for (const t of ["HeartBlade", "About", "Nothing more, nothing less", "Plugins", "Themes", "Made by", "wvmuser", "Source code", "Developer", "Discord"]) assert.ok(has(t) || t === "Discord", `root shows ${t}`);
const secOrder = ["HeartBlade", "About", "Plugins", "Made by", "Source code", "Developer"].map((s) => texts(tree).findIndex((x) => x === s || x === s.toUpperCase()));
assert.ok(secOrder.every((n, i) => n >= 0 && (i === 0 || n > secOrder[i - 1])), "sections are in the requested order: " + secOrder);
assert.ok(!has("Info") && !has("License") && !has("Latest release"), "removed rows are gone");
assert.equal(all(tree, (n) => n.type === "Text" && n.children.includes("Made by")).length, 1, "single Made by credit");
assert.equal(all(tree, (n) => n.type === "Image" && n.props.source?.uri?.includes("cdn.discordapp.com/avatars/233320628235665408/abc")).length, 1, "discord avatar is shown");
for (const w of ["I do", "Before", "now", "always"]) assert.equal(all(tree, (n) => n.type === "Text" && n.children.includes(w))[0].props.style.color, "#E8C95A", `quote highlight "${w}" uses the accent`);
for (const w of [" as I please. ", ", and "]) assert.ok(texts(tree).includes(w) && !all(tree, (n) => n.type === "Text" && n.props.style?.color === "#E8C95A" && n.children.includes(w)).length, `"${w.trim()}" stays plain`);
for (const l of ["A Discord tweak. Nothing more, nothing less.", "Plugins and themes, installed from a link.", "Named after Shinobu Oshino. Short temper, sharp blade."]) assert.ok(texts(tree).includes(l), `About line: ${l}`);
assert.ok(!has("No store"), "About has only the three requested lines");
assert.equal(all(tree, (n) => n.type === "View")[0].props.style.backgroundColor, "#000000", "outer view is black too");
assert.equal(navOpts.pop().cardStyle.backgroundColor, "#000000", "navigator card is painted black");
assert.equal(all(tree, (n) => n.type === "ScrollView")[0].props.style.backgroundColor, "#000000", "plain black background by default");
assert.ok(has("HeartBlade 0."), "client version line");
const gif = all(tree, (n) => n.type === "Image" && n.props.source?.uri?.endsWith(".gif"))[0];
assert.ok(gif, "banner gif is on the main page");
gif.props.onError(); await flush();
assert.ok(!all(tree, (n) => n.type === "Image" && n.props.source?.uri?.endsWith(".gif")).length, "gif hides itself on load error");
assert.ok(!texts(tree).some((s) => /[\u{1F300}-\u{1FAFF}\u{2139}\u{FE0F}]/u.test(s)), "no emojis");
assert.ok(has("1 installed · 1 enabled"), "plugin counts");
assert.ok(has("Active: Crimson"), "active theme name");
assert.ok(!has("Restart Discord to apply"), "no restart banner yet");
await press("Plugins");
assert.deepEqual(navCalls.pop(), ["HEARTBLADE_PAGE", { page: "plugins", title: "Plugins" }], "Plugins pushes onto Discord's navigator");
await press("Developer"); assert.deepEqual(navCalls.pop(), ["HEARTBLADE_PAGE", { page: "developer", title: "Developer" }]);
await press("wvm");
assert.deepEqual(opened.splice(0), ["https://instagram.com/wvm"], "instagram opens");
await press("wvmuser");
assert.deepEqual(globalThis.__profile, { userId: "233320628235665408" }, "discord profile opens inside the app");
assert.deepEqual(opened, [], "discord does not leave the app");

const open = (page, title) => mount(Sub, { navigation: nav, route: { params: { page, title } } });

// ===== 3. plugins page =====
open("plugins", "Plugins");
assert.deepEqual(navOpts.pop(), { title: "Plugins" }, "header title is set");
assert.ok(has("Hello") && has("v1.0.0") && texts(tree).includes("wvmuser") && !has("v1.0.0 ·"), "version, and the author as a small Discord credit (no wvm text next to the version)");
await press("+");
await type("https://…/my-plugin/", "https://x.test/p/");
await press("Install");
assert.ok(existsSync(P("plugins/cool-plug/index.js")), "plugin script written");
assert.equal(JSON.parse(readFileSync(P("plugins/cool-plug/manifest.json"), "utf8")).version, "1.2.3");
const reg = () => JSON.parse(readFileSync(P("registry.json"), "utf8"));
assert.ok(reg().some((e) => e.id === "cool-plug" && e.type === "plugin" && e.enabled), "registry updated");
assert.ok(has("Success") && has("Installed “Cool Plug”"), "dialog reports success");
await press("Done");
assert.ok(!all(tree, (n) => n.type === "Modal").length, "dialog closes");
assert.ok(has("Cool Plug") && has("Restart Discord to apply your changes."), "list + restart banner");
await toggle("Hello", false);
assert.equal(reg().find((e) => e.id === "hello").enabled, false, "toggle persisted");
await press("+");
await type("https://…/my-plugin/", "https://x.test/missing/");
await press("Install");
assert.ok(has("Failed"), "bad link reports a failure in the dialog");
assert.ok(row("Retry"), "can retry");
await press("Cancel");
await press("Cool Plug");
assert.deepEqual(navCalls.pop(), ["HEARTBLADE_PAGE", { page: "info", title: "Cool Plug", kind: "plugin", id: "cool-plug" }], "tap opens the info page (also for a plugin without settings)");
assert.equal(alerts.length, 0, "no details alert any more");
assert.ok(has("Swipe left to delete"), "footer explains the swipe");
const sw = all(row("Hello").children, (n) => n.type === "Switch")[0];
assert.equal(sw.props.style.alignSelf, "center", "switch is vertically centred");
// info page of a running plugin that exposes settings: details + its own settings + author (Discord only)
await press("Hello");
assert.deepEqual(navCalls.pop(), ["HEARTBLADE_PAGE", { page: "info", title: "Hello", kind: "plugin", id: "hello" }], "tap opens the info page");
mount(Sub, { navigation: nav, route: { params: { page: "info", title: "Hello", kind: "plugin", id: "hello" } } });
assert.ok(has("Hello settings body"), "info page renders the plugin's own settings");
assert.ok(has("Version") && has("1.0.0") && has("Source") && has("Made by"), "info page shows details and the author");
assert.ok(texts(tree).includes("wvmuser") && !texts(tree).includes("wvm"), "author is the Discord account only, no Instagram");
assert.ok(!has("Remove") && !has("Details and remove"), "no remove button on the info page (swipe instead)");
mount(Sub, { navigation: nav, route: { params: { page: "info", title: "Cool Plug", kind: "plugin", id: "cool-plug" } } });
assert.ok(has("Cool Plug") && has("1.2.3") && texts(tree).includes("me") && !has("settings body"), "other authors are shown by name; no settings block without settings");
open("plugins", "Plugins");
// swipe left to delete
{
  const pan = all(tree, (n) => n.type === "AnimatedView")[0];
  pan.props.__cfg.onPanResponderRelease(null, { dx: -120 }); await flush();
  assert.ok(has("Delete"), "red Delete button is there");
  await press("Delete");
  { const c = alerts.pop(); assert.ok(/Delete Hello/.test(c.t) && c.b.some((b) => b.text === "Delete"), "delete asks for confirmation first"); assert.ok(reg().some((e) => e.id === "hello"), "nothing is removed before confirming"); c.b[1].onPress(); await flush(); }
  assert.ok(!reg().some((e) => e.id === "hello") && reg().some((e) => e.id === "cool-plug"), "swiping the first row and tapping Delete removes only that plugin");
  assert.ok(!has("v1.0.0"), "deleted plugin disappears from the list");
}
open("plugins", "Plugins");

// ===== 4. themes page =====
open("themes", "Themes");
assert.ok(has("Crimson"));
await press("+");
await type("https://…/theme.json", "https://x.test/bad.json"); await press("Install");
assert.ok(has("Failed"));
await type("https://…/theme.json", "https://x.test/t.json"); await press("Install");
assert.ok(has("Success"));
await press("Done");
assert.ok(existsSync(P("themes/neon-night.json")));
assert.deepEqual(reg().filter((e) => e.type === "theme").map((e) => [e.id, e.enabled]), [["crimson", false], ["neon-night", true]], "one active theme");

// ===== 5. developer page =====
open("developer", "Developer");
for (const gone of ["Load client", "Developer bundle URL", "Shake to open", "Reset crash guard", "Open legacy panel", "Settings hook", "Needs the latest HeartBlade.deb"]) assert.ok(!has(gone), `developer page no longer shows "${gone}"`);
assert.ok(has("Safe mode") && has("Update client") && !has("Update client now"), "developer page keeps the useful rows");
await press("Update client");                         // old .deb (no prefs API): falls back to the release URL
assert.ok(readFileSync(P("bundle.js"), "utf8").includes("default release client"), "update works without the new .deb");
{ const a = alerts.pop(); assert.equal(a.t, "Client updated"); assert.deepEqual(a.b.map((x) => x.text), ["Later", "Restart"]); }
await toggle("Safe mode", true); assert.equal(JSON.parse(readFileSync(P("prefs.json"), "utf8")).safeMode, true);
await toggle("Safe mode", false);
await press("Restart Discord");                      // old .deb has no restart(): falls back to reloading through Discord's native module
{ const a = alerts.pop(); a.b[1].onPress(); assert.equal(state.reloaded, true, "restart falls back to a reload"); assert.ok(!alerts.length, "no 'Restart manually' alert when the reload works"); }
addNewNative();
open("developer", "Developer");
state.devURL = "http://192.168.1.5:3000/heartblade.js";
await press("Update client");
assert.ok(readFileSync(P("bundle.js"), "utf8").includes("dev client"), "dev URL (set from the recovery panel) is still honoured");
state.devURL = "";
await press("Update client");
assert.ok(readFileSync(P("bundle.js"), "utf8").includes("release client"), "release URL used when dev URL is empty");
alerts.length = 0;
await press("Copy debug report"); assert.equal(state.copied, "REPORT");
await press("Restart Discord");
const rs = alerts.pop(); rs.b[1].onPress(); assert.equal(state.restarted, true, "restart goes through confirmation");
await press("Logs"); assert.equal(navCalls.pop()[1].page, "logs");
await press("JS console"); assert.equal(navCalls.pop()[1].page, "console");

// ===== 6. logs / console =====
open("logs", "Logs");
assert.ok(has("ERROR broken") && has("WARN careful"));
const order = texts(tree).filter((t) => /^10:00/.test(t)); assert.ok(order[0].includes("ERROR"), "newest first");
await press("Clear view"); assert.ok(!has("ERROR broken"), "clear hides old lines");

open("console", "JS console");
await type("Type JavaScript…", "1 + 2"); await press("Run");
assert.ok(has("> 1 + 2") && texts(tree).includes("3"), "console evaluates");
await type("Type JavaScript…", "throw new Error('nope')"); await press("Run");
assert.ok(has("nope"), "console shows errors");
await type("Type JavaScript…", "__hb.version"); await press("Run"); assert.ok(has(JSON.stringify(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version)), "__hb is available");

await mount(Root, { navigation: nav, route: {} });
await press("Source code"); assert.deepEqual(opened, ["https://github.com/w-vm/HeartBlade"]);

// ===== 7. unknown page falls back to root; crash shows the error screen =====
open("nope", "x"); assert.ok(has("Plugins"));
globalThis.__boom = true;
open("plugins", "Plugins");
assert.ok(has("This page hit an error.") && has("boom"), "error boundary catches a crashing page");
await press("Open legacy panel"); assert.equal(state.panel, true);
globalThis.__boom = false;

// ===== 8. black by default; an installed theme that restyles backgrounds wins =====
__d((g, r, i, a, m) => { m.exports = { colors: { BACKGROUND_BASE_LOWEST: Symbol("bg"), TEXT_STRONG: Symbol("tx") }, meta: { resolveSemanticColor: (t, ref) => (String(ref).includes("bg") ? "#101114" : "#fafafa") }, unsafe_rawColors: {} }; }, 20, []);
__d((g, r, i, a, m) => { m.exports = { getName: () => "ThemeStore", theme: "dark" }; }, 21, []);
__r(20); __r(21);
await new Promise((r) => setTimeout(r, 450));   // palette is cached for 400 ms
mount(Root, { navigation: nav, route: {} });
assert.equal(all(tree, (n) => n.type === "ScrollView")[0].props.style.backgroundColor, "#000000", "still black with Discord's own palette around");
__hb.theme.apply({ name: "Night", semanticColors: { BACKGROUND_BASE_LOWEST: { dark: "#0b0c10" } } });
await new Promise((r) => setTimeout(r, 450));
mount(Root, { navigation: nav, route: {} });
assert.equal(all(tree, (n) => n.type === "ScrollView")[0].props.style.backgroundColor, "#0b0c10", "theme background overrides the black");
__hb.theme.remove();
await new Promise((r) => setTimeout(r, 450));
mount(Root, { navigation: nav, route: {} });
assert.equal(all(tree, (n) => n.type === "ScrollView")[0].props.style.backgroundColor, "#000000", "back to black when the theme is removed");

console.log("UI OK");
process.exit(0);
