import * as native from "../native";
import { BRAND } from "../brand";
import { log, error } from "../log";
import { moduleCount } from "../metro";
import { runningPlugins, pluginSettings, pluginPage } from "../plugins";
import { readPrefs, setPref } from "../prefs";
import { diag } from "../diag";
import { updateState, onUpdateState, checkUpdates, clearUpdates, markClientCurrent, updatesPending, updateSummary } from "../updates";
import { Kind, listEntries, readMeta, setEnabled, remove, installPlugin, installTheme, updateClient, updatePlugins, updateThemes, needsRestart, markChanged } from "../manager";
import { RN, RX, h, palette, Screen, Hero, Quote, Prose, SmallLines, InstagramGlyph, Group, Row, SwitchRow, HeaderButton, Check, Banner, Field, PlusButton, AddDialog, LogoImage, alert, confirm, prompt, copy, openUrl, reloadApp } from "./kit";
import { cachedUser, loadUser, openProfile } from "./discord";
import { sysInfo } from "../sysinfo";
import { ConsolePage } from "./console";

export const PAGE_ROUTE = "HEARTBLADE_PAGE";

// ---- navigation ---------------------------------------------------------------------------------------------

function go(props: any, page: string, title: string, extra?: Record<string, any>) {
  const nav = props?.navigation;
  const params = { page, title, ...(extra ?? {}) };
  try {
    if (typeof nav?.push === "function") return nav.push(PAGE_ROUTE, params);
    if (typeof nav?.navigate === "function") return nav.navigate(PAGE_ROUTE, params);
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
    const offUpdates = onUpdateState(bump);
    return () => { try { if (typeof off === "function") off(); } catch { /* ignore */ } offUpdates(); };
  }, []);
  return bump;
}

/** Soft refresh: Discord reloads its own JS (no need to open the app again). If nothing happens it falls back to closing the app. */
const doRestart = (auto?: boolean) => {
  if (reloadApp()) {
    setTimeout(() => {                  // still running 2.5 s later: the reload did nothing
      if (native.restartApp()) return;
      alert("Restart manually", "Close Discord from the app switcher and open it again.");
    }, 2500);
    return;
  }
  if (native.restartApp()) return;     // the tweak closes the app
  alert("Restart manually", "Close Discord from the app switcher and open it again.");
};
const restartNow = () => confirm("Refresh Discord?", "Discord reloads itself to apply your changes. You do not need to open it again.", "Refresh", () => doRestart());

/** Paint the navigator's chrome (header + card behind the page) in the page colour so no Discord-coloured edges show. */
function useChrome(props: any) {
  const { useEffect } = RX();
  useEffect(() => {
    try {
      const bg = palette().bg;
      props?.navigation?.setOptions?.({
        headerStyle: { backgroundColor: bg, shadowColor: "transparent", elevation: 0 },
        cardStyle: { backgroundColor: bg },
        contentStyle: { backgroundColor: bg },
      });
    } catch { /* ignore */ }
  }, []);
}

// ---- root ---------------------------------------------------------------------------------------------------

/** Discord credit: the author's account (avatar + username) read from Discord itself; tapping opens the profile inside the app. */
function DiscordRow(props: { id?: string } | null) {
  const { useState, useEffect } = RX();
  const { Image } = RN();
  const id = props?.id ?? BRAND.discordId;
  const [user, setUser] = useState(() => cachedUser(id));
  useEffect(() => {
    if (user) return;
    let alive = true;
    loadUser(id).then((u) => { if (alive && u) setUser(u); }, () => { /* keep the fallback */ });
    return () => { alive = false; };
  }, []);
  return Row({
    left: user?.avatar ? h(Image, { source: { uri: user.avatar }, style: { width: 32, height: 32, borderRadius: 16 } }) : null,
    title: user ? user.username : "Discord",
    subtitle: user ? undefined : id,
    chevron: true,
    onPress: () => openProfile(id),
  });
}

/** Small author credit for list rows: the author's Discord avatar + name (only for the project's author; others show their name). */
const isMine = (name: string) => {
  const n = name.trim().toLowerCase();
  const u = cachedUser(BRAND.discordId)?.username?.toLowerCase();
  return n === BRAND.author.toLowerCase() || n === BRAND.instagram.toLowerCase() || (!!u && (n === u || n === "@" + u));
};

function AuthorChip(props: { name: string }) {
  const { useState, useEffect } = RX();
  const { View, Text, Image, Pressable } = RN(); const P = palette();
  const mine = isMine(props.name);
  const [user, setUser] = useState(() => (mine ? cachedUser(BRAND.discordId) : null));
  useEffect(() => {
    if (!mine || user) return;
    let alive = true;
    loadUser(BRAND.discordId).then((u) => { if (alive && u) setUser(u); }, () => { /* keep the fallback */ });
    return () => { alive = false; };
  }, []);
  return h(Pressable, { disabled: !mine, hitSlop: 8, onPress: () => openProfile(BRAND.discordId), style: { flexDirection: "row", alignItems: "center", marginTop: 5, alignSelf: "flex-start" } },
    mine && user?.avatar ? h(Image, { source: { uri: user.avatar }, style: { width: 15, height: 15, borderRadius: 8, marginRight: 5 } }) : null,
    h(Text, { numberOfLines: 1, style: { color: P.muted, fontSize: 12 } }, mine ? (user?.username ?? "Discord") : props.name));
}

function RootPage(props: any) {
  const { useState } = RX();
  const { View, Image } = RN(); const P = palette();
  useRefresh(props);
  useChrome(props);
  const [gifFailed, setGifFailed] = useState(false);
  const plugins = listEntries("plugin"), themes = listEntries("theme");
  const on = plugins.filter((e) => e.enabled).length;
  const active = themes.find((e) => e.enabled);
  const si = sysInfo();

  const kids: any[] = [];
  if (needsRestart()) kids.push(Banner({ text: "Changes saved. Refresh Discord to apply them.", action: "Refresh", onAction: restartNow }));
  else if (updatesPending()) kids.push(Banner({ text: `Update available: ${updateSummary()}.`, action: "Update", onAction: () => go(props, "developer", "Developer") }));

  // icon + name, banner, quote
  kids.push(Hero());
  if (BRAND.aboutGif && !gifFailed) {
    kids.push(h(View, { style: { height: 190, borderRadius: 12, overflow: "hidden", backgroundColor: P.card } },
      h(Image, { source: { uri: BRAND.aboutGif }, resizeMode: "cover", style: { width: "100%", height: "100%" }, onError: () => setGifFailed(true) })));
  }
  kids.push(Quote());

  // about (plain text, no box)
  kids.push(Prose({
    title: "About",
    paragraphs: [
      "A Discord tweak. Nothing more, nothing less.",
      "Plugins and themes, installed from a link.",
      "Named after Shinobu Oshino. Short temper, sharp blade.",
    ],
  }));

  // plugins + themes
  kids.push(Group({
    children: [
      Row({ title: "Plugins", subtitle: plugins.length ? `${plugins.length} installed · ${on} enabled` : "Add extra functionality", chevron: true, onPress: () => go(props, "plugins", "Plugins") }),
      Row({ title: "Themes", subtitle: active ? `Active: ${readMeta("theme", active.id).name}` : themes.length ? "None active" : "Restyle Discord", chevron: true, onPress: () => go(props, "themes", "Themes") }),
    ],
  }));

  // made by
  kids.push(Group({
    title: "Made by",
    children: [
      Row({ left: InstagramGlyph({ size: 22 }), title: BRAND.instagram, chevron: true, onPress: () => openUrl(BRAND.instagramUrl) }),
      h(DiscordRow, null),
    ],
    footer: "Personal project, do not expect updates. Plugins run with full access to your account, so install only what you trust. Not affiliated with Discord.",
  }));

  // source + developer
  kids.push(Group({
    children: [
      Row({ title: "Source code", subtitle: "github.com/w-vm/HeartBlade", chevron: true, onPress: () => openUrl(BRAND.repo) }),
      Row({ title: "Developer", subtitle: "Logs, console and client tools", chevron: true, onPress: () => go(props, "developer", "Developer") }),
    ],
  }));

  // versions (small text, no box)
  kids.push(SmallLines([
    `HeartBlade ${__HB_VERSION__}`,
    si.discord ? `Discord ${si.discord}${si.build ? ` (${si.build})` : ""}` : "",
    si.model || si.os ? `${si.model ?? "iOS"}${si.os ? ` (${si.os})` : ""}` : "",
  ]));
  return Screen({ children: kids });
}

// ---- plugins / themes ---------------------------------------------------------------------------------------

function ManagerPage(props: any) {
  const { useState } = RX();
  const kind: Kind = props.kind;
  const isPlugin = kind === "plugin";
  const bump = useRefresh(props);
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState(null as string[] | null);
  const [upd, setUpd] = useState({ busy: false, msg: "" });
  const entries = listEntries(kind);

  // Manual plugin update: re-reads each plugin from its link, installs only what changed, and says what happened.
  const checkPluginUpdates = () => {
    if (upd.busy) return;
    setUpd({ busy: true, msg: "Checking…" });
    (isPlugin ? updatePlugins : updateThemes)().then((r) => {
      const msg = r.updated.length
        ? `Found an update and installed it: ${r.updated.join(", ")}. Use Refresh Discord to apply.`
        : r.failed && !r.current ? "Could not check (offline or the link is unavailable)." : "No update found.";
      setUpd({ busy: false, msg }); bump();
    }, (e: any) => setUpd({ busy: false, msg: `Could not check (${String(e?.message ?? e)})` }));
  };

  const noun = isPlugin ? "plugin" : "theme";
  const ids = entries.map((e) => e.id);
  const chosen = sel ? sel.filter((id) => ids.includes(id)) : [];
  const toggleSel = (id: string) => setSel((cur) => { const c = cur ?? []; return c.includes(id) ? c.filter((x) => x !== id) : c.concat(id); });
  const deleteChosen = () => {
    const n = chosen.length; if (!n) return;
    confirm(`Delete ${n} ${noun}${n > 1 ? "s" : ""}?`, `The selected ${noun}s and their saved data will be removed from this device.`, "Delete", () => { chosen.forEach((id) => remove(kind, id)); setSel(null); bump(); }, true);
  };

  const rows = entries.map((e) => {
    const m = readMeta(kind, e.id);
    const author = (m.author ?? "").trim();
    const sub = m.version ? `v${m.version}` : author ? undefined : e.url;
    const extra = author ? h(AuthorChip, { name: author }) : undefined;
    // Selection mode: tap toggles the check mark. Normal mode: tap opens the info page, hold deletes (after a confirmation).
    if (sel) return Row({ left: h(Check, { on: chosen.includes(e.id) }), title: m.name, subtitle: sub, extra, lines: 1, onPress: () => toggleSel(e.id) });
    const open = () => go(props, "info", m.name, { kind, id: e.id });
    const askDelete = () => confirm(`Delete ${m.name}?`, `${isPlugin ? "The plugin" : "The theme"} and its saved data will be removed from this device.`, "Delete", () => { remove(kind, e.id); bump(); }, true);
    return SwitchRow({ title: m.name, subtitle: sub, extra, lines: 1, on: !!e.enabled, onChange: (v: boolean) => { setEnabled(kind, e.id, v); bump(); }, onPress: open, onLongPress: askDelete });
  });

  const kids: any[] = [];
  if (needsRestart()) kids.push(Banner({ text: "Refresh Discord to apply your changes.", action: "Refresh", onAction: restartNow }));
  kids.push(Group({
    title: `${isPlugin ? "Plugins" : "Themes"}${entries.length ? ` · ${entries.length}` : ""}`,
    headerRight: h(RN().View, { style: { flexDirection: "row", alignItems: "center" } },
      sel
        ? [h(HeaderButton, { key: "c", label: "Cancel", onPress: () => setSel(null) }), h(HeaderButton, { key: "d", label: `Delete (${chosen.length})`, danger: true, disabled: !chosen.length, onPress: deleteChosen })]
        : [entries.length ? h(HeaderButton, { key: "s", label: "Select", onPress: () => setSel([]) }) : null, h(RN().View, { key: "p", style: { marginLeft: 8 } }, PlusButton({ onPress: () => setAdding(true) }))]),
    footer: entries.length ? (sel ? `Tap to select, then Delete. ${chosen.length} selected.` : `Tap ${isPlugin ? "a plugin" : "a theme"} for its info${isPlugin ? " and settings" : ""}. Hold to delete, or use Select to delete several.`) : undefined,
    children: rows.length ? rows : [Row({ title: isPlugin ? "No plugins yet" : "No themes yet", subtitle: "Tap + to add one from a link.", center: true })],
  }));
  if (entries.length) {
    kids.push(Group({
      children: [Row({ title: "Check for updates", accent: true, subtitle: upd.msg || `Looks for newer versions of your ${isPlugin ? "plugins" : "themes"} and installs them.`, lines: 4, onPress: checkPluginUpdates })],
    }));
  }
  // The dialog sits next to the screen (not inside the list), so a restart banner appearing above does not remount it.
  return h(RX().Fragment, null,
    Screen({ children: kids }),
    adding
      ? h(AddDialog, {
        title: isPlugin ? "Add a plugin" : "Add a theme",
        hint: isPlugin
          ? "A folder with manifest.json + index.js, a manifest.json link, or a single .js file. Plugins run with full access to your account, so only install code you trust."
          : "A .json file that uses Discord’s colour token names (semanticColors / rawColors).",
        placeholder: isPlugin ? "https://…/my-plugin/" : "https://…/theme.json",
        install: (link: string) => (isPlugin ? installPlugin : installTheme)(link),
        onChanged: bump,
        onClose: () => { setAdding(false); bump(); },
      })
      : null);
}

// ---- plugin / theme info ------------------------------------------------------------------------------------

/** A sub page a plugin opened from its settings (props.open(name, title)). */
function PluginPage(props: any) {
  useRefresh(props);
  useChrome(props);
  const C = pluginPage(props?.route?.params?.id ?? "", props?.route?.params?.name ?? "");
  if (!C) return Screen({ children: [Prose({ paragraphs: ["This page is not available. The plugin may be turned off."] })] });
  return Screen({ children: [h(C, { navigation: props.navigation })] });
}

/** Info page of one plugin or theme: details, its own settings (plugins that have them), and who made it. */
function InfoPage(props: any) {
  const { View } = RN();
  useRefresh(props);
  const kind: Kind = props?.route?.params?.kind === "theme" ? "theme" : "plugin";
  const id: string = props?.route?.params?.id ?? "";
  const entry = listEntries(kind).find((e) => e.id === id);
  const m = readMeta(kind, id);
  const link = entry?.url ?? "";
  const Settings = kind === "plugin" ? pluginSettings(id) : undefined;
  const author = (m.author ?? "").trim();

  const kids: any[] = [];
  if (needsRestart()) kids.push(Banner({ text: "Refresh Discord to apply your changes.", action: "Refresh", onAction: restartNow }));

  kids.push(Group({
    title: kind === "plugin" ? "Plugin" : "Theme",
    children: [
      Row({ title: m.name, subtitle: m.description, lines: 8 }),
      m.version ? Row({ title: "Version", value: String(m.version) }) : null,
      entry ? Row({ title: "Status", value: entry.enabled ? "Enabled" : "Disabled" }) : null,
      link ? Row({ title: "Source", subtitle: link, lines: 2, onPress: () => openUrl(link) }) : null,
    ],
  }));

  if (Settings) kids.push(h(View, { style: { marginBottom: 22 } }, h(Settings, { key: id, open: (name: string, title: string) => go(props, "plugin", title || name, { id, name }) })));

  // Made by: same credit as the HeartBlade page, with the Discord account only (no Instagram).
  if (author) {
    const mine = isMine(author);
    kids.push(Group({ title: "Made by", children: [mine ? h(DiscordRow, null) : Row({ title: author })] }));
  }
  return Screen({ children: kids });
}

// ---- developer ----------------------------------------------------------------------------------------------

function DeveloperPage(props: any) {
  const bump = useRefresh(props);
  const safe = !!readPrefs().safeMode;

  const kids: any[] = [];
  if (needsRestart()) kids.push(Banner({ text: "Refresh Discord to apply your changes.", action: "Refresh", onAction: restartNow }));

  kids.push(Group({
    title: "Safety",
    footer: "Applies the next time Discord starts. If Discord ever fails to start, shake the phone to open the recovery panel.",
    children: [
      SwitchRow({ title: "Safe mode", subtitle: "Start Discord without any plugins or the active theme. Turn it on if something breaks.", on: safe, onChange: (v: boolean) => { setPref("safeMode", v); markChanged(); bump(); } }),
    ],
  }));

  const us = updateState();
  const status = us.phase === "checking" ? "Checking for updates…"
    : us.phase === "error" ? `Could not check (${us.error ?? "offline"}). Tap to try again.`
      : us.phase === "idle" ? "Tap to check"
        : updatesPending() ? "Update available. Tap Update client below."
          : "No new update. This is the latest version.";
  kids.push(Group({
    title: "Client updates",
    footer: "HeartBlade tells you once when a new client is out. It never installs anything on its own. Plugins are updated from the Plugins page.",
    children: [
      Row({ title: "Check for updates", subtitle: status, lines: 3, accent: updatesPending(), onPress: () => { checkUpdates().then(bump, bump); bump(); } }),
      Row({
        title: "Update client", accent: true, subtitle: `Installed: ${__HB_VERSION__}. Downloads the latest client. Your plugins and themes are not touched.`,
        onPress: () => updateClient().then(
          () => {
            clearUpdates(); markClientCurrent(); bump();
            alert("Client updated", "Discord refreshes now to use the new client.", [{ text: "Later", style: "cancel" }, { text: "Refresh", onPress: () => doRestart() }]);
          },
          (e: any) => alert("Update failed", String(e?.message ?? e))),
      }),
    ],
  }));

  kids.push(Group({
    title: "Debug",
    children: [
      Row({ title: "Logs", subtitle: "Live HeartBlade log", chevron: true, onPress: () => go(props, "logs", "Logs") }),
      Row({ title: "JS console", subtitle: "Run code inside Discord", chevron: true, onPress: () => go(props, "console", "JS console") }),
      Row({ title: "Copy debug report", onPress: () => copy(native.debugReport() || fallbackReport(), "The debug report") }),
    ],
  }));

  kids.push(Group({
    title: "Runtime",
    children: [
      Row({ title: "Plugins running", value: String(runningPlugins().length) }),
      Row({ title: "Modules registered", value: String(moduleCount()) }),
    ],
  }));

  kids.push(Group({ children: [Row({ title: "Refresh Discord", accent: true, center: true, onPress: restartNow })] }));
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

// ---- screens ------------------------------------------------------------------------------------------------

const PAGES: Record<string, (p: any) => any> = {
  root: (p) => h(RootPage, p),
  plugins: (p) => h(ManagerPage, { ...p, kind: "plugin" }),
  themes: (p) => h(ManagerPage, { ...p, kind: "theme" }),
  info: (p) => h(InfoPage, p),
  plugin: (p) => h(PluginPage, p),
  developer: (p) => h(DeveloperPage, p),
  logs: (p) => h(LogsPage, p),
  console: (p) => h(ConsolePage, p),
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
          Hero(),
          Prose({ paragraphs: ["This page hit an error."] }),
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
  useChrome(props);
  useEffect(() => { try { props?.navigation?.setOptions?.({ title: params.title ?? BRAND.name }); } catch { /* ignore */ } }, [page, params.title]);
  return h(boundary(), null, PAGES[page](props));
}

export { LogoImage };
