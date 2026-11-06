// Tiny UI kit for the HeartBlade settings pages, built only from React Native primitives that Discord already ships.
// Colours follow the user's current Discord theme when the colour resolver can be found, with safe fallbacks.
import * as metro from "../metro";
import * as native from "../native";
import { BRAND, LOGO_PNG } from "../brand";
import { error } from "../log";
import { themeRestylesColors, themeColor } from "../themes";

const lz = metro.lazy;
export const RN = lz<any>(() => metro.findByProps("AppRegistry", "Alert"));
export const RX = lz<any>(() => metro.findByProps("createElement", "useState"));
export const h = (type: any, props?: any, ...children: any[]) => RX().createElement(type, props ?? null, ...children);

// ---- palette ------------------------------------------------------------------------------------------------

export interface Palette { dark: boolean; bg: string; card: string; text: string; muted: string; sep: string; input: string; accent: string; danger: string; ok: string; onAccent: string; }

const rawColors = lz<any>(() => metro.findLoaded((m: any) => m.unsafe_rawColors || (m.colors && m.meta)));
const themeStore = lz<any>(() => metro.findLoaded(metro.byStoreName("ThemeStore")));
const themeName = (): string => {
  try { const t = themeStore()?.theme; return typeof t === "string" ? t : "dark"; } catch { return "dark"; }
};

function token(names: string[]): string | undefined {
  try {
    const m = rawColors();
    const meta = m?.meta ?? m?.default?.meta;
    const tokens = m?.colors ?? m?.default?.colors;
    if (!meta?.resolveSemanticColor || !tokens) return undefined;
    const theme = themeName();
    for (const n of names) {
      const ref = tokens[n];
      if (!ref) continue;
      const v = meta.resolveSemanticColor(theme, ref);
      if (typeof v === "string" && /^(#|rgb)/i.test(v)) return v;
    }
  } catch { /* fall through */ }
  return undefined;
}

function parseColor(c: string): [number, number, number] | null {
  let m = /^#([0-9a-f]{6})/i.exec(c);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map((x) => parseInt(x + x, 16)) as [number, number, number];
  const r = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(c);
  return r ? [+r[1], +r[2], +r[3]] : null;
}
const toHex = (c: number[]) => "#" + c.map((x) => ("0" + Math.max(0, Math.min(255, Math.round(x))).toString(16)).slice(-2)).join("");
const mix = (a: [number, number, number], b: [number, number, number], t: number) => toHex(a.map((x, i) => x + (b[i] - x) * t));

let cached: { at: number; p: Palette } | undefined;
/** Resolved at most every 400 ms: pages call this for every row, and resolving tokens is not free. */
export function palette(): Palette {
  const now = Date.now();
  if (cached && now - cached.at < 400) return cached.p;
  const p = computePalette();
  cached = { at: now, p };
  return p;
}

function computePalette(): Palette {
  // Plain black by default. If an installed theme restyles the colours, follow Discord (the theme wins).
  const themed = themeRestylesColors();
  const name = themed ? themeName() : "dark";
  const dark = name !== "light";
  const fb = dark
    ? { bg: "#000000", text: "#f2f3f5", muted: "#a0a3ab" }
    : { bg: "#f2f3f5", text: "#1a1a1e", muted: "#686b73" };
  const bg = (themed ? token(["BACKGROUND_BASE_LOWEST", "BACKGROUND_TERTIARY", "BACKGROUND_PRIMARY"]) : undefined) ?? fb.bg;
  const text = (themed ? token(["TEXT_STRONG", "TEXT_NORMAL"]) : undefined) ?? fb.text;
  const muted = (themed ? token(["TEXT_MUTED", "TEXT_SECONDARY"]) : undefined) ?? fb.muted;
  const bgRgb = parseColor(bg) ?? parseColor(fb.bg)!;
  const card = mix(bgRgb, dark ? [255, 255, 255] : [0, 0, 0], dark ? 0.08 : 0.035);
  const sepBase = dark ? "255,255,255" : "0,0,0";
  return {
    dark, bg, text, muted, card,
    sep: `rgba(${sepBase},0.10)`,
    input: mix(bgRgb, dark ? [255, 255, 255] : [0, 0, 0], dark ? 0.04 : 0.06),
    accent: BRAND.accent, danger: "#f23f43", ok: "#3ba55d", onAccent: "#16130a",
  };
}

export interface SheetColors { sheet: string; card: string; text: string; muted: string; line: string; blue: string; handle: string; ring: string; circle: string; press: string; dark: boolean; }
/** Colours for plugin sheets and cards. Discord's dark look by default; when an installed theme restyles colours, everything follows the theme. */
export function sheetColors(): SheetColors {
  const base: SheetColors = { sheet: "#232428", card: "#2b2d31", text: "#f2f3f5", muted: "#b5bac1", line: "#3a3c42", blue: "#5865f2", handle: "#4e5058", ring: "#80848e", circle: "#111214", press: "rgba(255,255,255,0.06)", dark: true };
  try {
    if (!themeRestylesColors()) return base;
    const P = palette();
    const bg = parseColor(P.bg); if (!bg) return base;
    const to: [number, number, number] = P.dark ? [255, 255, 255] : [0, 0, 0];
    const t = P.dark ? 1 : 0.55;
    // Follow the theme's own tokens first (so the Account Manager button / sheet change with the theme like Discord's cards do);
    // the mixed greys are only the fallback for themes that do not define them.
    const blue = themeColor(["CONTROL_BRAND_FOREGROUND", "CONTROL_BRAND_FOREGROUND_NEW", "BUTTON_FILLED_BRAND_BACKGROUND", "BUTTON_PRIMARY_BACKGROUND"]) ?? token(["CONTROL_BRAND_FOREGROUND", "BUTTON_PRIMARY_BACKGROUND", "REDESIGN_BUTTON_PRIMARY_BACKGROUND", "BUTTON_BACKGROUND_BRAND", "BRAND_500", "TEXT_BRAND"]) ?? base.blue;
    const sheet = themeColor(["ACTION_SHEET_BACKGROUND", "BOTTOM_SHEET_BACKGROUND", "BACKGROUND_FLOATING"]) ?? token(["ACTION_SHEET_BACKGROUND", "BOTTOM_SHEET_BACKGROUND", "BACKGROUND_FLOATING", "BG_SURFACE_OVERLAY"]) ?? mix(bg, to, 0.07 * t);
    const card = themeColor(["CARD_PRIMARY_BG", "CARD_SECONDARY_BG", "BG_SURFACE_RAISED", "BACKGROUND_SECONDARY"]) ?? token(["CARD_PRIMARY_BG", "CARD_SECONDARY_BG", "BG_SURFACE_RAISED", "BACKGROUND_SECONDARY"]) ?? mix(bg, to, 0.13 * t);
    const line = themeColor(["BORDER_SUBTLE", "BORDER_FAINT"]) ?? token(["BORDER_SUBTLE", "BORDER_FAINT"]) ?? (P.dark ? "rgba(255,255,255,0.16)" : P.sep);
    const handle = themeColor(["BORDER_STRONG"]) ?? token(["BORDER_STRONG"]) ?? mix(bg, to, 0.3 * t);
    return {
      sheet, card, text: P.text, muted: P.muted,
      line, blue, handle, ring: P.muted, circle: mix(bg, to, 0.04 * t),
      press: P.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)", dark: P.dark,
    };
  } catch { return base; }
}

// ---- icons --------------------------------------------------------------------------------------------------

/** Discord's own icon component by name, if it is already loaded (never force-initialises modules). */
const iconCache = new Map<string, any>();
export function discordIcon(...names: string[]): any {
  const key = names.join("|");
  if (iconCache.has(key)) return iconCache.get(key);
  let found: any;
  for (const n of names) {
    try { const mod = metro.findLoaded(metro.byProps(n)); const c = mod?.[n]; if (c) { found = c; break; } } catch { /* next */ }
  }
  iconCache.set(key, found); // misses are cached too: scanning every module on each render would be slow
  return found;
}

/** The HeartBlade icon (full colour, not tinted). Also used as the settings-row icon (Discord passes size / color props). */
export function LogoImage(props: any = {}) {
  const { Image } = RN();
  const size = typeof props.size === "number" ? props.size : props.width ?? 24;
  return h(Image, { source: { uri: LOGO_PNG }, style: { width: size, height: size }, resizeMode: "contain" });
}

// ---- building blocks ----------------------------------------------------------------------------------------

function ScreenBody(p: { content: any[] }) {
  const { View, ScrollView } = RN(); const P = palette();
  // The outer View paints the whole area (corners and safe areas included), so Discord's own colour never peeks through.
  return h(View, { style: { flex: 1, backgroundColor: P.bg } },
    h(ScrollView, {
      style: { flex: 1, backgroundColor: P.bg },
      contentContainerStyle: { padding: 16, paddingBottom: 56, backgroundColor: P.bg },
      contentInsetAdjustmentBehavior: "automatic",
      keyboardShouldPersistTaps: "handled",
    }, ...p.content));
}

export function Screen(p: { children: any[]; refreshControl?: any }) {
  return h(ScreenBody, { content: p.children });
}

export function Hero(p: { size?: number } = {}) {
  const { View, Text } = RN(); const P = palette();
  return h(View, { style: { alignItems: "center", paddingTop: 6, paddingBottom: 18 } },
    LogoImage({ size: p.size ?? 104 }),
    h(Text, { style: { color: P.text, fontSize: 28, fontWeight: "800", marginTop: 8, letterSpacing: 0.4 } }, BRAND.name));
}

/** The Shinobu quote, with "I" and "Before, now, and always" in the accent colour. */
export function Quote() {
  const { Text } = RN(); const P = palette();
  return h(Text, { style: { color: P.muted, fontSize: 14, fontStyle: "italic", textAlign: "center", lineHeight: 20, marginTop: 12, marginBottom: 26, paddingHorizontal: 20 } },
    "“", ...BRAND.quoteParts.map(([s, hi]: [string, boolean], i: number) => (hi ? h(Text, { key: "q" + i, style: { color: P.accent, fontWeight: "600" } }, s) : s)), "”");
}

/** Plain text section (no box): small accent label + paragraphs. */
export function Prose(p: { title?: string; paragraphs: string[] }) {
  const { View, Text } = RN(); const P = palette();
  return h(View, { style: { marginBottom: 26, marginHorizontal: 6 } },
    p.title ? h(Text, { style: { color: P.accent, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 } }, p.title) : null,
    ...p.paragraphs.map((t, i) => h(Text, { key: "p" + i, style: { color: P.text, fontSize: 14.5, lineHeight: 21, marginTop: i ? 6 : 0 } }, t)));
}

/** A few small centred lines of muted text (no box). */
export function SmallLines(lines: string[]) {
  const { View, Text } = RN(); const P = palette();
  return h(View, { style: { alignItems: "center", marginTop: 2, marginBottom: 8 } },
    ...lines.filter(Boolean).map((t, i) => h(Text, { key: "s" + i, style: { color: P.muted, fontSize: 12, lineHeight: 18, textAlign: "center" } }, t)));
}

/** Instagram glyph drawn with plain views (rounded square, lens, dot): crisp at any size, no image needed. */
export function InstagramGlyph(p: { size?: number; color?: string }) {
  const { View } = RN(); const P = palette();
  const s = p.size ?? 22, c = p.color ?? P.text, w = Math.max(2, Math.round(s / 11));
  return h(View, { style: { width: s, height: s, borderRadius: s * 0.3, borderWidth: w, borderColor: c, alignItems: "center", justifyContent: "center" } },
    h(View, { style: { width: s * 0.46, height: s * 0.46, borderRadius: s * 0.23, borderWidth: w, borderColor: c } }),
    h(View, { style: { position: "absolute", top: s * 0.14, right: s * 0.14, width: w + 1, height: w + 1, borderRadius: (w + 1) / 2, backgroundColor: c } }));
}

export function Group(p: { title?: string; footer?: string; headerRight?: any; children: any[] }) {
  const { View, Text, StyleSheet } = RN(); const P = palette(); const R = RX();
  const kids = p.children.filter(Boolean);
  const hair = StyleSheet?.hairlineWidth ?? 1;
  const items: any[] = [];
  kids.forEach((k: any, i: number) => {
    if (i > 0) items.push(h(View, { key: "d" + i, style: { height: hair, marginLeft: 16, backgroundColor: P.sep } }));
    items.push(h(R.Fragment, { key: "r" + i }, k));
  });
  const header = p.title || p.headerRight
    ? h(View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, marginHorizontal: 6, minHeight: 28 } },
      h(Text, { style: { color: P.accent, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 } }, p.title ?? ""),
      p.headerRight ?? null)
    : null;
  return h(View, { style: { marginBottom: 22 } },
    header,
    h(View, { style: { backgroundColor: P.card, borderRadius: 12, borderWidth: hair, borderColor: P.sep, overflow: "hidden" } }, ...items),
    p.footer ? h(Text, { style: { color: P.muted, fontSize: 12.5, marginTop: 8, marginHorizontal: 8, lineHeight: 17 } }, p.footer) : null,
  );
}

/** Small "+" button for a group header. */
export function PlusButton(p: { onPress: () => void }) {
  const { Pressable, Text } = RN(); const P = palette();
  return h(Pressable, { onPress: p.onPress, accessibilityLabel: "Add", hitSlop: 8, style: ({ pressed }: any) => ({ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: P.accent, opacity: pressed ? 0.7 : 1 }) },
    h(Text, { style: { color: P.onAccent, fontSize: 20, fontWeight: "600", lineHeight: 22, marginTop: -1 } }, "+"));
}

/** Small text button for a group header (Select / Cancel / Delete). */
export function HeaderButton(p: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  const { Pressable, Text } = RN(); const P = palette();
  return h(Pressable, { onPress: p.onPress, disabled: p.disabled, hitSlop: 8, style: ({ pressed }: any) => ({ paddingHorizontal: 6, opacity: p.disabled ? 0.4 : pressed ? 0.6 : 1 }) },
    h(Text, { style: { color: p.danger ? P.danger : P.accent, fontSize: 14, fontWeight: "700" } }, p.label));
}

/** Round check mark used in selection mode. */
export function Check(p: { on: boolean }) {
  const { View, Text } = RN(); const P = palette();
  return h(View, { style: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: p.on ? P.accent : P.muted, backgroundColor: p.on ? P.accent : "transparent", alignItems: "center", justifyContent: "center" } },
    p.on ? h(Text, { style: { color: P.onAccent, fontSize: 14, fontWeight: "800", marginTop: -1 } }, "✓") : null);
}

export interface RowProps {
  title: string; subtitle?: string; value?: string; left?: any;
  onPress?: () => void; onLongPress?: () => void; chevron?: boolean; right?: any;
  accent?: boolean; destructive?: boolean; center?: boolean; lines?: number; mono?: boolean; extra?: any;
}

export function Row(p: RowProps) {
  const { View, Text, Pressable } = RN(); const P = palette();
  const color = p.destructive ? P.danger : p.accent ? P.accent : P.text;
  // The Pressable only handles the touch and the pressed colour; the layout lives in an inner View so the row's
  // vertical centring never depends on how Pressable lays out its children.
  return h(Pressable, {
    disabled: !p.onPress && !p.onLongPress,
    onPress: p.onPress, onLongPress: p.onLongPress,
    style: ({ pressed }: any) => ({ backgroundColor: pressed ? P.sep : "transparent" }),
  },
    h(View, { style: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, minHeight: 54 } },
      p.left ? h(View, { style: { marginRight: 12, width: 34, alignItems: "center", justifyContent: "center" } }, p.left) : null,
      h(View, { style: { flex: 1, paddingVertical: 12, alignItems: p.center ? "center" : "stretch" } },
        h(Text, { style: { color, fontSize: p.mono ? 12 : 16, fontWeight: p.center || p.accent ? "600" : "500", fontFamily: p.mono ? "Menlo" : undefined } }, p.title),
        p.subtitle ? h(Text, { numberOfLines: p.lines ?? 2, style: { color: P.muted, fontSize: 13, marginTop: 2, lineHeight: 18 } }, p.subtitle) : null,
        p.extra ?? null),
      p.value != null ? h(Text, { numberOfLines: 1, style: { color: P.muted, fontSize: 15, marginLeft: 10, maxWidth: "45%" } }, p.value) : null,
      p.right ? h(View, { style: { marginLeft: 12, alignSelf: "center", alignItems: "center", justifyContent: "center" } }, p.right) : null,
      p.chevron ? h(Text, { style: { color: P.muted, fontSize: 24, marginLeft: 8, marginTop: -2 } }, "›") : null,
    ));
}

export function SwitchRow(p: RowProps & { on: boolean; onChange: (v: boolean) => void }) {
  const { Switch } = RN(); const P = palette();
  return Row({
    ...p,
    right: h(Switch, { value: p.on, onValueChange: p.onChange, trackColor: { true: P.accent, false: P.sep }, ios_backgroundColor: P.sep, thumbColor: "#ffffff", style: { alignSelf: "center", margin: 0 } }),
  });
}

/**
 * "+" dialog: type or paste a link, install it, and show success or failure right inside the dialog.
 * Rendered only while open, so every opening starts clean.
 */
export function AddDialog(p: { title: string; hint: string; placeholder: string; install: (link: string) => Promise<string>; onChanged: () => void; onClose: () => void }) {
  const { useState } = RX();
  const { Modal, View, Text, Pressable, TextInput, KeyboardAvoidingView, StyleSheet } = RN(); const P = palette();
  const [link, setLink] = useState("");
  const [phase, setPhase] = useState("idle" as "idle" | "busy" | "ok" | "fail");
  const [msg, setMsg] = useState("");
  const hair = StyleSheet?.hairlineWidth ?? 1;

  const run = () => {
    const l = link.trim();
    if (phase === "busy" || !l) return;
    setPhase("busy"); setMsg("");
    p.install(l).then((m) => { setMsg(m); setPhase("ok"); p.onChanged(); }, (e: any) => { error("install failed", e?.message ?? e); setMsg(String(e?.message ?? e)); setPhase("fail"); });
  };

  const btn = (label: string, onPress: () => void, kind: "primary" | "plain" = "plain", disabled = false) =>
    h(Pressable, { onPress, disabled, style: ({ pressed }: any) => ({ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, marginLeft: 8, opacity: disabled ? 0.5 : pressed ? 0.7 : 1, backgroundColor: kind === "primary" ? P.accent : "transparent" }) },
      h(Text, { style: { color: kind === "primary" ? P.onAccent : P.muted, fontSize: 15, fontWeight: "600" } }, label));

  const status = phase === "ok"
    ? h(View, { style: { marginTop: 14 } },
      h(Text, { style: { color: P.ok, fontSize: 15, fontWeight: "700" } }, "Success"),
      h(Text, { style: { color: P.muted, fontSize: 13, marginTop: 3, lineHeight: 18 } }, `${msg}. Restart Discord to apply.`))
    : phase === "fail"
      ? h(View, { style: { marginTop: 14 } },
        h(Text, { style: { color: P.danger, fontSize: 15, fontWeight: "700" } }, "Failed"),
        h(Text, { style: { color: P.muted, fontSize: 13, marginTop: 3, lineHeight: 18 } }, msg))
      : phase === "busy" ? h(Text, { style: { color: P.muted, fontSize: 13, marginTop: 14 } }, "Installing…") : null;

  const Wrap = KeyboardAvoidingView ?? View;
  return h(Modal, { visible: true, transparent: true, animationType: "fade", onRequestClose: p.onClose },
    h(Wrap, { behavior: "padding", style: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.6)" } },
      h(View, { style: { backgroundColor: P.card, borderRadius: 14, borderWidth: hair, borderColor: P.sep, padding: 18 } },
        h(Text, { style: { color: P.text, fontSize: 18, fontWeight: "700" } }, p.title),
        h(Text, { style: { color: P.muted, fontSize: 13, marginTop: 6, lineHeight: 18 } }, p.hint),
        h(TextInput, {
          value: link, onChangeText: (v: string) => { setLink(v); if (phase === "fail" || phase === "ok") setPhase("idle"); }, placeholder: p.placeholder, placeholderTextColor: P.muted,
          autoCapitalize: "none", autoCorrect: false, spellCheck: false, keyboardType: "url", returnKeyType: "go", onSubmitEditing: run, selectionColor: P.accent, editable: phase !== "busy",
          style: { color: P.text, backgroundColor: P.input, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginTop: 14 },
        }),
        status,
        h(View, { style: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", marginTop: 16 } },
          h(View, { style: { flexDirection: "row" } },
            btn(phase === "ok" ? "Done" : "Cancel", p.onClose),
            phase === "ok" ? null : btn(phase === "fail" ? "Retry" : "Install", run, "primary", phase === "busy" || !link.trim()))),
      )));
}

export function Banner(p: { text: string; action?: string; onAction?: () => void }) {
  const { View, Text, Pressable } = RN(); const P = palette();
  return h(View, { style: { flexDirection: "row", alignItems: "center", backgroundColor: P.accent, borderRadius: 14, padding: 14, marginBottom: 20 } },
    h(Text, { style: { flex: 1, color: P.onAccent, fontSize: 14, fontWeight: "600", lineHeight: 19 } }, p.text),
    p.action ? h(Pressable, { onPress: p.onAction, style: { marginLeft: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.25)" } },
      h(Text, { style: { color: P.onAccent, fontWeight: "700", fontSize: 13 } }, p.action)) : null);
}

export function Field(p: { value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; mono?: boolean; minHeight?: number; onSubmit?: () => void }) {
  const { TextInput, View } = RN(); const P = palette();
  return h(View, { style: { padding: 12 } },
    h(TextInput, {
      value: p.value, onChangeText: p.onChange, placeholder: p.placeholder, placeholderTextColor: P.muted,
      autoCapitalize: "none", autoCorrect: false, spellCheck: false, multiline: !!p.multiline,
      keyboardType: p.multiline ? "default" : "url", returnKeyType: p.multiline ? "default" : "go",
      onSubmitEditing: p.onSubmit, selectionColor: P.accent,
      style: { color: P.text, backgroundColor: P.input, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: p.mono ? 13 : 15, fontFamily: p.mono ? "Menlo" : undefined, minHeight: p.minHeight ?? 40, textAlignVertical: "top" },
    }));
}

export function Note(text: string, center = true) {
  const { Text } = RN(); const P = palette();
  return h(Text, { style: { color: P.muted, fontSize: 13, lineHeight: 18, textAlign: center ? "center" : "left", marginBottom: 18, paddingHorizontal: 10 } }, text);
}

// ---- helpers ------------------------------------------------------------------------------------------------

export const alert = (title: string, message?: string, buttons?: any[]) => { try { RN()?.Alert?.alert(title, message, buttons); } catch { /* ignore */ } };

export function confirm(title: string, message: string, action: string, onConfirm: () => void, destructive = false, onCancel?: () => void) {
  alert(title, message, [{ text: "Cancel", style: "cancel", onPress: onCancel }, { text: action, style: destructive ? "destructive" : "default", onPress: onConfirm }]);
}

/** iOS text prompt (Alert.prompt); falls back to a plain alert if it is missing. */
export function prompt(title: string, message: string, initial: string, onSubmit: (text: string) => void) {
  const A = RN()?.Alert;
  if (typeof A?.prompt === "function") A.prompt(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Save", onPress: (t: string) => onSubmit(t ?? "") }], "plain-text", initial, "url");
  else alert(title, "Text input is not available on this build.");
}

const clipboard = lz<any>(() => metro.findLoaded(metro.byProps("getString", "setString")));
export function copy(text: string, what = "Text") {
  if (native.copyText(text)) return alert("Copied", `${what} is on your clipboard.`);
  try { clipboard()?.setString(text); return alert("Copied", `${what} is on your clipboard.`); } catch { /* fall through */ }
  alert("Could not copy", "Clipboard access is not available (update the HeartBlade .deb).");
}
export const readClipboard = (): Promise<string> => {
  try { const c = clipboard(); if (c?.getString) return Promise.resolve(c.getString()).then((s: any) => String(s ?? "")); } catch { /* ignore */ }
  return Promise.resolve("");
};

/**
 * Fallback restart for a native side that has no restart(): reload the app through Discord's own native modules
 * (the same call other mods use). Returns true when one of them accepted the call.
 */
export function reloadApp(): boolean {
  const tryCall = (get: () => any): boolean => { try { const f = get(); if (typeof f === "function") { f(); return true; } } catch { /* next */ } return false; };
  const proxy = () => (globalThis as any).nativeModuleProxy;
  const mods = () => RN()?.NativeModules;
  return tryCall(() => { const m = proxy()?.BundleUpdaterManager ?? mods()?.BundleUpdaterManager; return m?.reload ? () => m.reload() : undefined; })
    || tryCall(() => { const m = proxy()?.DevSettings ?? mods()?.DevSettings; return m?.reload ? () => m.reload() : undefined; })
    || tryCall(() => { const m = RN()?.DevSettings; return m?.reload ? () => m.reload() : undefined; });
}

export function openUrl(url: string, onFail?: () => void) {
  try { const r: any = RN()?.Linking?.openURL(url); if (onFail && r && typeof r.catch === "function") r.catch(() => onFail()); }
  catch { if (onFail) onFail(); }
}
