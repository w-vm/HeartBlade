// Tests the developer tools (module search, where(), UI spy with parent chain, trace) against a fake Metro + React.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "hb-dev-"));
writeFileSync(join(dir, "registry.json"), "[]");
globalThis.__HB_NATIVE__ = { version: "t", dir, readFile: () => null, writeFile: () => true, exists: () => false, listDir: () => [], removeFile: () => true };

const defs = new Map(); const cache = new Map();
globalThis.__r = (id) => { if (cache.has(id)) return cache.get(id).exports; const m = { exports: {} }; cache.set(id, m); defs.get(id)(globalThis, globalThis.__r, null, null, m, m.exports, []); return m.exports; };
(0, eval)((await import("node:fs")).readFileSync(new URL("../dist/heartblade.js", import.meta.url), "utf8"));
globalThis.__d = (f, id) => defs.set(id, f);

const $$typeof = Symbol.for("react.element");
const React = { useState() {}, createElement(type, props, ...kids) { return { $$typeof, type, props: { ...props, children: kids.length === 1 ? kids[0] : kids } }; } };
function NoteCard() { return null; }
function ProfileBody() { return null; }
const Mods = { ProfileBody, NoteCard };
__d((g, r, i, a, m) => { m.exports = React; }, 1, []);
__d((g, r, i, a, m) => { m.exports = Mods; }, 2, []);
__d((g, r, i, a, m) => { m.exports = { getToken() { return "x"; }, other: 1 }; }, 3, []);
[1, 2, 3].forEach(__r);

await new Promise((r) => setTimeout(r, 250));
const dev = __hb.dev;
assert.match(dev.names("note").text, /#2\s+NoteCard -> NoteCard/);
assert.match(dev.modules("gettok").text, /#3/);
assert.match(dev.props("getToken", "other").text, /#3/);
assert.deepEqual(dev.moduleOf(NoteCard), ["#2 NoteCard"]);
assert.match(dev.fns(3).text, /getToken: function/);

// UI spy: text "Note" inside NoteCard's output, which sits inside ProfileBody
dev.spy.start("Note");
const label = React.createElement("Text", null, "Note");
const card = React.createElement(NoteCard, { title: "x" }, label);
const body = React.createElement(ProfileBody, null, card);
const res = dev.spy.results().text;
assert.match(res, /"Note"/); assert.match(res, /<Text>/);
assert.match(res, /<NoteCard> #2 NoteCard/); assert.match(res, /<ProfileBody> #2 ProfileBody/);
const nested = React.createElement("Row", { title: { text: "Orbs Balance", extra: [1] }, onPress() {} });
assert.match(dev.spy.texts("orbs").text, /"Orbs Balance"\s+<Row>/);
dev.spy.stop();
const n = dev.spy.results().text; // still readable after stop
assert.match(n, /stopped/);

// trace
const target = { f(a) { return a + 1; } };
dev.trace(target, "f"); target.f(1);
assert.match(dev.traces().text, /f\(1\)/);
dev.untrace(); assert.equal(target.f(1), 2);
assert.match(dev.help().text, /dev.spy.start/);
console.log("DEV OK");
process.exit(0);
