// JS console page. State lives at module level, so leaving the page (or closing Settings) keeps the code you were typing,
// the output history and the tool state. Output is in memory only (never written to disk: it may contain secrets).
import { dev, Out } from "../dev";
import { RN, RX, h, palette, Screen, Group, Row, HeaderButton, Field, copy, prompt } from "./kit";

interface Entry { id: number; code: string; out: string; err?: boolean; ms: number; }

const S = { code: "", history: [] as Entry[], seq: 0, busy: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
const MAX_ENTRIES = 60;
const MAX_OUT = 40000;

export function show(v: any): string {
  try {
    if (v instanceof Out) return v.text;
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "string") return v;
    if (typeof v === "function") return `ƒ ${v.name || "anonymous"}\n${String(v).slice(0, 400)}`;
    if (v instanceof Error) return `${v.name}: ${v.message}\n${String(v.stack ?? "").split("\n").slice(0, 8).join("\n")}`;
    if (v && typeof v === "object") {
      const seen = new Set<any>();
      const s = JSON.stringify(v, (_k, x) => {
        if (typeof x === "function") return `[ƒ ${x.name || ""}]`;
        if (typeof x === "bigint") return String(x);
        if (x && typeof x === "object") { if (seen.has(x)) return "[Circular]"; seen.add(x); }
        return x;
      }, 1);
      return s ?? String(v);
    }
    return String(v);
  } catch { try { return String(v); } catch { return "[unprintable]"; } }
}

function push(code: string, v: any, err: boolean, t0: number) {
  let text = show(v);
  if (text.length > MAX_OUT) text = text.slice(0, MAX_OUT) + `\n…(truncated, ${text.length - MAX_OUT} more chars)`;
  S.history = [{ id: ++S.seq, code, out: text, err, ms: Date.now() - t0 }, ...S.history].slice(0, MAX_ENTRIES);
  S.busy = false;
  emit();
}

/** Evaluate in Discord's global scope. Supports `await` and remembers the last value as $_ . */
export function runCode(src: string) {
  src = src.trim();
  if (!src) return;
  const g: any = globalThis;
  g.dev = dev; // so `dev.names('x')` works without the __hb prefix
  const t0 = Date.now();
  const fail = (e: any) => push(src, e instanceof Error ? e : String(e?.message ?? e), true, t0);
  const ok = (v: any) => { g.$_ = v; push(src, v, false, t0); };
  const settle = (r: any) => (r && typeof r.then === "function" ? (S.busy = true, emit(), r.then(ok, fail)) : ok(r));
  try {
    if (/\bawait\b/.test(src)) {
      try { return settle((0, eval)(`(async()=>(${src}\n))()`)); }
      catch (e: any) { if (!(e instanceof SyntaxError)) throw e; return settle((0, eval)(`(async()=>{${src}\n})()`)); }
    }
    settle((0, eval)(src));
  } catch (e) { fail(e); }
}

let setCodeLocal: ((s: string) => void) | null = null;
/** Put text into the code box from outside (snippets, tapping an old command). */
function putCode(text: string) { S.code = text; try { setCodeLocal?.(text); } catch { /* ignore */ } }

function useConsole() {
  const { useState, useEffect } = RX();
  const [, set] = useState(0);
  useEffect(() => { const l = () => set((n: number) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return S;
}

const SNIPPETS: Array<[string, string, string]> = [
  ["Help", "All developer tools", "dev.help()"],
  ["Find a component by name", "e.g. Profile, Note, Banner", "dev.names('Profile')"],
  ["Find modules by export key", "e.g. getToken, openProfile", "dev.modules('profile')"],
  ["Start UI spy for a text", "Then open the screen, then Spy results", "dev.spy.start('Note')"],
  ["Spy results", "Matches, parent chain and module of each", "dev.spy.results()"],
  ["Inspect a store", "Methods and fields", "dev.store('UserStore')"],
  ["Functions of a module", "Use an id from the results (#1234)", "dev.fns(1234)"],
  ["Loaded modules", "First 40", "dev.modules('')"],
];

export function ConsolePage(_props: any) {
  const { View, Text, Pressable } = RN(); const P = palette();
  const st = useConsole();
  const { useState: useS, useEffect: useE } = RX();
  const [code, setCode] = useS(S.code);
  useE(() => { setCodeLocal = setCode; return () => { if (setCodeLocal === setCode) setCodeLocal = null; }; }, []);
  dev.spy.mute(true); // the console's own text must never show up as a spy match

  const copyAll = () => copy(st.history.slice().reverse().map((e) => `> ${e.code}\n${e.out}`).join("\n\n"), "The whole console output");
  const askAndRun = (title: string, msg: string, make: (t: string) => string) => prompt(title, msg, "", (t) => { if (t.trim()) runCode(make(t.trim().replace(/'/g, "\\'"))); });

  const entry = (e: Entry) => h(View, { key: e.id, style: { paddingHorizontal: 14, paddingVertical: 10 } },
    h(Pressable, { onPress: () => putCode(e.code), hitSlop: 4 },
      h(Text, { style: { color: P.muted, fontSize: 12, fontFamily: "Menlo" }, numberOfLines: 3 }, `> ${e.code}`)),
    h(Text, { selectable: true, style: { color: e.err ? P.danger : P.text, fontSize: 12.5, fontFamily: "Menlo", marginTop: 4, lineHeight: 17 } },
      e.out.length > 6000 ? e.out.slice(0, 6000) + `\n…(${e.out.length - 6000} more chars — tap Copy for everything)` : e.out),
    h(View, { style: { flexDirection: "row", marginTop: 8, alignItems: "center" } },
      HeaderButton({ label: "Copy", onPress: () => copy(e.out, "The output") }),
      h(View, { style: { width: 14 } }),
      HeaderButton({ label: "Copy with code", onPress: () => copy(`> ${e.code}\n${e.out}`, "The code and output") }),
      h(View, { style: { flex: 1 } }),
      h(Text, { style: { color: P.muted, fontSize: 11 } }, `${e.ms} ms`)));

  const page = Screen({
    children: [
      Group({
        title: "JS console",
        footer: "Runs inside Discord’s own JS engine with full access. Supports await. The last result is $_ . Tap an old command to reuse it.",
        children: [
          Field({ value: code, onChange: (t) => { S.code = t; setCode(t); }, placeholder: "Type JavaScript…", multiline: true, mono: true, minHeight: 90 }),
          Row({ title: st.busy ? "Running…" : "Run", accent: true, center: true, onPress: () => runCode(S.code) }),
        ],
      }),
      Group({
        title: "Find things in Discord",
        footer: "Use these to locate the component or function to patch. Spy: start it, open the screen you care about, then show the results.",
        children: [
          Row({ title: "Find component by name…", subtitle: "Which function renders it, and in which module", chevron: true, onPress: () => askAndRun("Find component", "Part of its name (names are minified, try several).", (t) => `dev.names('${t}')`) }),
          Row({ title: "Find module by export key…", subtitle: "e.g. getToken, openProfile, createList", chevron: true, onPress: () => askAndRun("Find module", "Part of an export name.", (t) => `dev.modules('${t}')`) }),
          Row({ title: "UI spy: start…", subtitle: "Records rendered text and the components around it", chevron: true, onPress: () => askAndRun("UI spy", "Text visible on the screen, e.g. Note or Edit Profile.", (t) => `dev.spy.start('${t}')`) }),
          Row({ title: "UI spy: show results", accent: true, onPress: () => runCode("dev.spy.results()") }),
          Row({ title: "UI spy: stop", onPress: () => runCode("dev.spy.stop(), 'spy stopped'") }),
        ],
      }),
      Group({
        title: "Quick commands",
        children: SNIPPETS.map(([title, sub, code]) => Row({ title, subtitle: sub || undefined, onPress: () => putCode(code) })),
      }),
      Group({
        title: st.history.length ? `Output · ${st.history.length}` : "Output",
        headerRight: st.history.length ? h(View, { style: { flexDirection: "row" } }, HeaderButton({ label: "Copy all", onPress: copyAll }), h(View, { style: { width: 12 } }), HeaderButton({ label: "Clear", danger: true, onPress: () => { st.history = []; emit(); } })) : undefined,
        footer: st.history.length ? "Kept while the app runs, even if you leave this page. Not saved to disk." : undefined,
        children: st.history.length ? st.history.map(entry) : [Row({ title: "Nothing yet", subtitle: "Run something above.", center: true })],
      }),
    ],
  });
  dev.spy.mute(false);
  return page;
}
