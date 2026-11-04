import * as native from "../native";
import { BRAND } from "../brand";
import { log, error } from "../log";
import { moduleCount } from "../metro";
import { runningPlugins } from "../plugins";
import { readPrefs, setPref } from "../prefs";
import { diag } from "../diag";
import { Kind, listEntries, readMeta, setEnabled, remove, installPlugin, installTheme, updateClient, needsRestart, markChanged } from "../manager";
import { RN, RX, h, palette, Screen, Hero, Group, Row, SwitchRow, Banner, Field, Note, LogoImage, alert, confirm, prompt, copy, readClipboard, openUrl, discordIcon } from "./kit";

export const PAGE_ROUTE = "HEARTBLADE_PAGE";

// ---- navigation ---------------------------------------------------------------------------------------------

function go(props: any, page: string, title: string) {
  const nav = props?.navigation;
  try {
    if (typeof nav?.push === "function") return nav.push(PAGE_ROUTE, { page, title });
    if (typeof nav?.navigate === "function") return nav.navigate(PAGE_ROUTE, { page, title });
  } catch (e) { error("navigate failed", e); }
  alert("Could not open the page", "Navigation is not available here. Use the legacy panel (shake your phone).");
}

/** Re-render when the screen regains focus (after coming back from a sub page). */
function useRefresh(props: any) {
  const { useState, useEffect } = RX();
  const [, set] = useState(0);
  const bump = () => set((n: number) => n + 1);
  useEffect(() => {
    const off = props?.navigation?.addListener?.("focus", bump);
    return () => { try { if (typeof off === "function") off(); } catch { /* ignore */ } };
  }, []);
  return bump;
}

const restartNow = () => confirm("Restart Discord?", "Discord will close. Open it again to apply your changes.", "Restart", () => {
  if (!native.restartApp()) alert("Restart manually", "Close Discord from the app switcher and open it again.");
});

// ---- root ---------------------------------------------------------------------------------------------------

function RootPage(props: any) {
  useRefresh(props);
  const plugins = listEntries("plugin"), themes = listEntries("theme");
  const on = plugins.filter((e) => e.enabled).length;
  const active = themes.find((e) => e.enabled);
  const kids: any[] = [
    Hero({ subtitle: BRAND.tagline, badge: `v${__HB_VERSION__}` }),
  ];
  if (needsRestart()) kids.push(Banner({ text: "Changes saved. Restart Discord to apply them.", action: "Restart", onAction: restartNow }));
  kids.push(Group({
    children: [
      Row({ title: "Plugins", subtitle: plugins.length ? `${plugins.length} installed · ${on} enabled` : "Add extra functionality", icon: discordIcon("PuzzlePieceIcon", "ExtensionIcon"), emoji: "🧩", iconTint: "#5865f2", chevron: true, onPress: () => go(props, "plugins", "Plugins") }),
      Row({ title: "Themes", subtitle: active ? `Active: ${readMeta("theme", active.id).name}` : themes.length ? "None active" : "Restyle Discord", icon: discordIcon("PaintPaletteIcon", "PaletteIcon"), emoji: "🎨", iconTint: "#e32945", chevron: true, onPress: () => go(props, "themes", "Themes") }),
      Row({ title: "Developer", subtitle: "Logs, console and client tools", icon: discordIcon("WrenchIcon", "TerminalIcon", "CodeIcon"), emoji: "🛠", iconTint: "#3ba55d", chevron: true, onPress: () => go(props, "developer", "Developer") }),
    ],
  }));
  kids.push(Group({
    children: [
      Row({ title: "About", subtitle: "Version, credits and license", icon: discordIcon("CircleInformationIcon", "InfoIcon"), emoji: "ℹ️", iconTint: "#747f8d", chevron: true, onPress: () => go(props, "about", "About") }),
    ],
    footer: `HeartBlade ${__HB_VERSION__} · native ${native.version()}`,
  }));
  return Screen({ children: kids });
}

// ---- plugins / themes ---------------------------------------------------------------------------------------

function ManagerPage(props: any) {
  const { useState } = RX();
  const kind: Kind = props.kind;
  const isPlugin = kind === "plugin";
  const bump = useRefresh(props);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const entries = listEntries(kind);

  const install = () => {
    const link = url.trim();
    if (busy || !link) return;
    setBusy(true);
    (isPlugin ? installPlugin : installTheme)(link).then((msg) => {
      setUrl(""); bump();
      alert(msg, "Restart Discord to apply.");
    }, (e: any) => {
      error("install failed", e?.message ?? e);
      alert("Install failed", String(e?.message ?? e));
    }).then(() => setBusy(false));
  };

  const details = (id: string, link: string) => {
    const m = readMeta(kind, id);
    const lines = [m.version && `Version ${m.version}`, m.author && `By ${m.author}`, m.description, link].filter(Boolean).join("\n\n");
    alert(m.name, lines, [{ text: "Close", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => confirm(`Remove ${m.name}?`, "Its files and saved data will be deleted.", "Remove", () => { remove(kind, id); bump(); }, true) }]);
  };

  const rows = entries.map((e) => {
    const m = readMeta(kind, e.id);
    const sub = [m.version && `v${m.version}`, m.author].filter(Boolean).join(" · ") || e.url;
    return SwitchRow({ title: m.name, subtitle: sub, lines: 1, on: !!e.enabled, onChange: (v: boolean) => { setEnabled(kind, e.id, v); bump(); }, onPress: () => details(e.id, e.url), onLongPress: () => details(e.id, e.url) });
  });

  const kids: any[] = [];
  if (needsRestart()) kids.push(Banner({ text: "Restart Discord to apply your changes.", action: "Restart", onAction: restartNow }));
  kids.push(Group({
    title: `Installed${entries.length ? ` · ${entries.length}` : ""}`,
    footer: entries.length ? "Tap an item for details or to remove it." : undefined,
    children: rows.length ? rows : [Row({ title: isPlugin ? "No plugins yet" : "No themes yet", subtitle: "Paste a link below to add one.", center: true })],
  }));
  kids.push(Group({
    title: isPlugin ? "Add a plugin" : "Add a theme",
    footer: isPlugin
      ? "A folder with manifest.json + index.js, a manifest.json link, or a single .js file. Plugins run with full access to your account — only install code you trust."
      : "A .json file that uses Discord’s colour token names (semanticColors / rawColors).",
    children: [
      Field({ value: url, onChange: setUrl, placeholder: isPlugin ? "https://…/my-plugin/" : "https://…/theme.json", onSubmit: install }),
      Row({ title: busy ? "Installing…" : "Install", accent: true, center: true, onPress: install }),
      Row({ title: "Paste from clipboard", center: true, onPress: () => readClipboard().then((s) => { if (s) setUrl(s.trim()); else alert("Clipboard is empty"); }) }),
    ],
  }));
  return Screen({ children: kids });
}

// ---- developer ----------------------------------------------------------------------------------------------

function DeveloperPage(props: any) {
  const bump = useRefresh(props);
  const prefs = native.getPrefs();
  const safe = !!readPrefs().safeMode;
  const stats = diag().stats();
  const needNew = (title: string) => Row({ title, subtitle: "Needs the latest HeartBlade.deb", value: "—" });

  const kids: any[] = [];
  if (needsRestart()) kids.push(Banner({ text: "Restart Discord to apply your changes.", action: "Restart", onAction: restartNow }));

  kids.push(Group({
    title: "Client",
    footer: "These switches apply the next time Discord starts.",
    children: [
      prefs
        ? SwitchRow({ title: "Load client", subtitle: "Off starts Discord without HeartBlade", on: !!prefs.client, onChange: (v: boolean) => { native.setPref("client", v ? "1" : "0"); markChanged(); bump(); } })
        : needNew("Load client"),
      SwitchRow({ title: "Safe mode", subtitle: "Skip all plugins and the active theme", on: safe, onChange: (v: boolean) => { setPref("safeMode", v); markChanged(); bump(); } }),
      Row({ title: "Update client now", accent: true, onPress: () => updateClient().then(() => alert("Client updated", "Restart Discord to use it."), (e: any) => alert("Update failed", String(e?.message ?? e))) }),
      prefs
        ? Row({ title: "Developer bundle URL", subtitle: "Load heartblade.js from your own server", value: prefs.devURL ? "on" : "off", chevron: true, onPress: () => prompt("Developer bundle URL", "Load heartblade.js from this URL on every launch, e.g. http://192.168.1.5:3000/heartblade.js. Leave empty to use the release build.", prefs.devURL, (t) => { native.setPref("devURL", t.trim()); bump(); }) })
        : needNew("Developer bundle URL"),
    ],
  }));

  kids.push(Group({
    title: "Debug",
    children: [
      Row({ title: "Logs", subtitle: "Live HeartBlade log", emoji: "📜", iconTint: "#747f8d", chevron: true, onPress: () => go(props, "logs", "Logs") }),
      Row({ title: "JS console", subtitle: "Run code inside Discord", emoji: "⌨️", iconTint: "#747f8d", chevron: true, onPress: () => go(props, "console", "JS console") }),
      Row({ title: "Copy debug report", onPress: () => copy(native.debugReport() || fallbackReport(), "The debug report") }),
    ],
  }));

  kids.push(Group({
    title: "Runtime",
    children: [
      Row({ title: "Modules registered", value: String(moduleCount()) }),
      Row({ title: "Plugins running", value: String(runningPlugins().length) }),
      Row({ title: "Settings hook", subtitle: `createList ×${stats.createListTargets ?? 0} · calls ${stats.createListCalls ?? 0} · overview ${stats.overviewSeen ? "seen" : "not seen"}`, value: stats.sectionsInserted ? "ok" : "waiting" }),
      Row({ title: "Reset crash guard", subtitle: "Re-enable the settings entry after an unclean launch", onPress: () => { diag().resetGuard(); alert("Crash guard reset", "The settings entry will load normally next launch."); } }),
    ],
  }));

  kids.push(Group({
    title: "Fallback",
    footer: "The legacy native panel is a backup in case the Discord settings entry ever breaks.",
    children: [
      prefs ? SwitchRow({ title: "Shake to open legacy panel", on: !!prefs.shake, onChange: (v: boolean) => { native.setPref("shake", v ? "1" : "0"); bump(); } }) : needNew("Shake to open legacy panel"),
      Row({ title: "Open legacy panel", onPress: () => native.openPanel() }),
    ],
  }));

  kids.push(Group({ children: [Row({ title: "Restart Discord", accent: true, center: true, onPress: restartNow })] }));
  return Screen({ children: kids });
}

const fallbackReport = () => `HeartBlade client ${__HB_VERSION__}, native ${native.version()}\nmodules: ${moduleCount()}, plugins: ${runningPlugins().join(",") || "-"}\n${JSON.stringify(diag().stats())}`;

// ---- logs ---------------------------------------------------------------------------------------------------

function LogsPage(props: any) {
  const { useState, useEffect, useRef } = RX();
  const { View, Text } = RN(); const P = palette();
  const [lines, setLines] = useState(() => native.getLogs());
  const cleared = useRef(null as string | null);
  useEffect(() => {
    const id = setInterval(() => setLines(native.getLogs()), 2000);
    return () => clearInterval(id);
  }, []);

  let shown: string[] = lines;
  if (cleared.current != null) { const at = lines.lastIndexOf(cleared.current); if (at >= 0) shown = lines.slice(at + 1); }
  const newest = [...shown].reverse().slice(0, 250);
  const color = (l: string) => (/ ERROR /.test(l) ? P.danger : / WARN /.test(l) ? "#f0b232" : P.text);

  return Screen({
    children: [
      Group({
        children: [
          Row({ title: "Refresh", accent: true, center: true, onPress: () => setLines(native.getLogs()) }),
          Row({ title: "Copy all", center: true, onPress: () => copy(shown.join("\n"), "The log") }),
          Row({ title: "Clear view", center: true, destructive: true, onPress: () => { cleared.current = lines.length ? lines[lines.length - 1] : null; setLines([...lines]); } }),
        ],
      }),
      Group({
        title: `Log · ${shown.length} line${shown.length === 1 ? "" : "s"}`,
        footer: "Newest first. Updates every two seconds.",
        children: newest.length
          ? newest.map((l) => h(View, { style: { paddingHorizontal: 14, paddingVertical: 8 } }, h(Text, { selectable: true, style: { color: color(l), fontSize: 11.5, fontFamily: "Menlo", lineHeight: 16 } }, l)))
          : [Row({ title: native.hasPrefsApi() ? "No log lines yet." : "Needs the latest HeartBlade.deb", center: true })],
      }),
    ],
  });
}

// ---- console ------------------------------------------------------------------------------------------------

interface Entry { code: string; out: string; err?: boolean; }

function show(v: any): string {
  try {
    if (v === undefined) return "undefined";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "function") return String(v).slice(0, 240);
    if (v && typeof v === "object") {
      const seen = new Set<any>();
      const s = JSON.stringify(v, (_k, x) => { if (typeof x === "function") return "[Function]"; if (x && typeof x === "object") { if (seen.has(x)) return "[Circular]"; seen.add(x); } return x; }, 1);
      return (s ?? String(v)).slice(0, 4000);
    }
    return String(v);
  } catch { try { return String(v); } catch { return "[unprintable]"; } }
}

function ConsolePage(_props: any) {
  const { useState } = RX();
  const { View, Text } = RN(); const P = palette();
  const [code, setCode] = useState("");
  const [history, setHistory] = useState([] as Entry[]);
  const push = (e: Entry) => setHistory((hs: Entry[]) => [e, ...hs].slice(0, 30));

  const run = () => {
    const src = code.trim();
    if (!src) return;
    let res: any;
    try { res = (0, eval)(src); } catch (e: any) { push({ code: src, out: String(e?.message ?? e), err: true }); return; }
    if (res && typeof res.then === "function") res.then((v: any) => push({ code: src, out: show(v) }), (e: any) => push({ code: src, out: String(e?.message ?? e), err: true }));
    else push({ code: src, out: show(res) });
  };

  return Screen({
    children: [
      Group({
        title: "JS console",
        footer: "Runs in Discord’s own JS engine with full access. Try  __hb.version  or  __hb.metro.findByProps('dispatch')",
        children: [
          Field({ value: code, onChange: setCode, placeholder: "Type JavaScript…", multiline: true, mono: true, minHeight: 90 }),
          Row({ title: "Run", accent: true, center: true, onPress: run }),
          history.length ? Row({ title: "Clear output", center: true, onPress: () => setHistory([]) }) : null,
        ],
      }),
      history.length
        ? Group({
          title: "Output",
          children: history.map((e) => h(View, { style: { paddingHorizontal: 14, paddingVertical: 10 } },
            h(Text, { style: { color: P.muted, fontSize: 12, fontFamily: "Menlo" }, numberOfLines: 3 }, `> ${e.code}`),
            h(Text, { selectable: true, style: { color: e.err ? P.danger : P.text, fontSize: 12.5, fontFamily: "Menlo", marginTop: 4, lineHeight: 17 } }, e.out))),
        })
        : null,
    ].filter(Boolean),
  });
}

// ---- about --------------------------------------------------------------------------------------------------

function AboutPage(_props: any) {
  const { useState } = RX();
  const { View, Image } = RN(); const P = palette();
  const [gifFailed, setGifFailed] = useState(false);
  const kids: any[] = [Hero({ subtitle: BRAND.tagline, badge: `v${__HB_VERSION__}`, quote: BRAND.quote })];
  if (BRAND.aboutGif && !gifFailed) {
    kids.push(h(View, { style: { height: 190, borderRadius: 16, overflow: "hidden", backgroundColor: P.card, marginBottom: 22 } },
      h(Image, { source: { uri: BRAND.aboutGif }, resizeMode: "cover", style: { width: "100%", height: "100%" }, onError: () => setGifFailed(true) })));
  }
  kids.push(Group({
    title: "HeartBlade",
    children: [
      Row({ title: "Client", value: __HB_VERSION__ }),
      Row({ title: "Native tweak", value: native.version() }),
      Row({ title: "License", value: `${BRAND.license} © ${BRAND.author}` }),
    ],
  }));
  kids.push(Group({
    title: "Credits",
    children: [
      Row({ title: "Made by", value: BRAND.author }),
      Row({ title: "Name & attitude", value: "Shinobu Oshino" }),
    ],
  }));
  kids.push(Group({
    title: "Links",
    children: [
      Row({ title: "Source code", subtitle: "github.com/w-vm/HeartBlade", chevron: true, onPress: () => openUrl(BRAND.repo) }),
      Row({ title: "Latest release", chevron: true, onPress: () => openUrl(BRAND.releases) }),
    ],
  }));
  kids.push(Note("Personal project — updates are not guaranteed. Plugins run with full access to your account, so install only what you trust. Not affiliated with Discord."));
  return Screen({ children: kids });
}

// ---- screens ------------------------------------------------------------------------------------------------

const PAGES: Record<string, (p: any) => any> = {
  root: (p) => h(RootPage, p),
  plugins: (p) => h(ManagerPage, { ...p, kind: "plugin" }),
  themes: (p) => h(ManagerPage, { ...p, kind: "theme" }),
  developer: (p) => h(DeveloperPage, p),
  logs: (p) => h(LogsPage, p),
  console: (p) => h(ConsolePage, p),
  about: (p) => h(AboutPage, p),
};

let Boundary: any;
function boundary() {
  if (Boundary) return Boundary;
  const R = RX();
  Boundary = class extends R.Component {
    constructor(props: any) { super(props); this.state = { err: null }; }
    static getDerivedStateFromError(err: any) { return { err }; }
    componentDidCatch(e: any) { try { error("settings ui crashed", String(e?.message ?? e), String(e?.stack ?? "").split("\n").slice(0, 6).join(" | ")); } catch { /* ignore */ } }
    render() {
      const err = (this as any).state.err;
      if (!err) return (this as any).props.children;
      return Screen({
        children: [
          Hero({ subtitle: "This page hit an error." }),
          Group({
            children: [
              Row({ title: "What happened", subtitle: String(err?.message ?? err), lines: 6 }),
              Row({ title: "Copy debug report", accent: true, onPress: () => copy(native.debugReport() || fallbackReport(), "The debug report") }),
              Row({ title: "Open legacy panel", onPress: () => native.openPanel() }),
            ],
          }),
        ],
      });
    }
  };
  return Boundary;
}

/** The screen behind the "HeartBlade" row in Discord's settings. */
let announced = false;
export function RootScreen(props: any) {
  if (!announced) { announced = true; log("settings: HeartBlade page opened"); }
  return h(boundary(), null, h(RootPage, props));
}

/** Generic sub page; the page name and title arrive as route params (navigation.push(PAGE_ROUTE, { page, title })). */
export function PageScreen(props: any) {
  const { useEffect } = RX();
  const params = props?.route?.params ?? {};
  const page: string = PAGES[params.page] ? params.page : "root";
  useEffect(() => { try { props?.navigation?.setOptions?.({ title: params.title ?? BRAND.name }); } catch { /* ignore */ } }, [page]);
  return h(boundary(), null, PAGES[page](props));
}

export { LogoImage };
