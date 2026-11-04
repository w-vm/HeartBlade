// Tiny UI kit for the HeartBlade settings pages, built only from React Native primitives that Discord already ships.
// Colours follow the user's current Discord theme when the colour resolver can be found, with safe fallbacks.
import * as metro from "../metro";
import * as native from "../native";
import { BRAND, LOGO_PNG } from "../brand";

const lz = metro.lazy;
export const RN = lz<any>(() => metro.findByProps("AppRegistry", "Alert"));
export const RX = lz<any>(() => metro.findByProps("createElement", "useState"));
export const h = (type: any, props?: any, ...children: any[]) => RX().createElement(type, props ?? null, ...children);

// ---- palette ------------------------------------------------------------------------------------------------

export interface Palette { dark: boolean; bg: string; card: string; text: string; muted: string; sep: string; input: string; accent: string; danger: string; onAccent: string; }

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
  const name = themeName();
  const dark = name !== "light";
  const fb = dark
    ? { bg: name === "midnight" ? "#000000" : "#1a1a1e", text: "#f2f3f5", muted: "#a0a3ab" }
    : { bg: "#f2f3f5", text: "#1a1a1e", muted: "#686b73" };
  const bg = token(["BACKGROUND_BASE_LOWEST", "BACKGROUND_TERTIARY", "BACKGROUND_PRIMARY"]) ?? fb.bg;
  const text = token(["TEXT_STRONG", "TEXT_NORMAL"]) ?? fb.text;
  const muted = token(["TEXT_MUTED", "TEXT_SECONDARY"]) ?? fb.muted;
  const bgRgb = parseColor(bg) ?? parseColor(fb.bg)!;
  const card = mix(bgRgb, dark ? [255, 255, 255] : [0, 0, 0], dark ? 0.07 : 0.035);
  const sepBase = dark ? "255,255,255" : "0,0,0";
  return {
    dark, bg, text, muted, card,
    sep: `rgba(${sepBase},0.09)`,
    input: mix(bgRgb, dark ? [255, 255, 255] : [0, 0, 0], dark ? 0.03 : 0.06),
    accent: BRAND.accent, danger: "#f23f43", onAccent: "#ffffff",
  };
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

/** The HeartBlade logo as a tinted image. Also used as the settings-row icon (Discord passes size / color props). */
export function LogoImage(props: any = {}) {
  const { Image } = RN();
  const size = typeof props.size === "number" ? props.size : props.width ?? 24;
  const tint = typeof props.color === "string" ? props.color : props.tint ?? palette().text;
  return h(Image, { source: { uri: LOGO_PNG }, style: { width: size, height: size, tintColor: tint }, resizeMode: "contain" });
}

// ---- building blocks ----------------------------------------------------------------------------------------

export function Screen(p: { children: any[]; refreshControl?: any }) {
  const { ScrollView } = RN(); const P = palette();
  return h(ScrollView, {
    style: { flex: 1, backgroundColor: P.bg },
    contentContainerStyle: { padding: 16, paddingBottom: 56 },
    contentInsetAdjustmentBehavior: "automatic",
    keyboardShouldPersistTaps: "handled",
  }, ...p.children);
}

export function Hero(p: { subtitle?: string; size?: number; quote?: string; badge?: string }) {
  const { View, Text } = RN(); const P = palette();
  const size = p.size ?? 76;
  return h(View, { style: { alignItems: "center", paddingTop: 8, paddingBottom: 22 } },
    LogoImage({ size, color: P.accent }),
    h(Text, { style: { color: P.text, fontSize: 28, fontWeight: "800", marginTop: 10, letterSpacing: 0.3 } }, BRAND.name),
    p.subtitle ? h(Text, { style: { color: P.muted, fontSize: 14, marginTop: 4, textAlign: "center", paddingHorizontal: 24, lineHeight: 19 } }, p.subtitle) : null,
    p.badge ? h(View, { style: { marginTop: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: P.card } },
      h(Text, { style: { color: P.muted, fontSize: 12, fontWeight: "600" } }, p.badge)) : null,
    p.quote ? h(Text, { style: { color: P.muted, fontSize: 13, fontStyle: "italic", marginTop: 12, textAlign: "center", paddingHorizontal: 28 } }, `“${p.quote}”`) : null,
  );
}

export function Group(p: { title?: string; footer?: string; children: any[] }) {
  const { View, Text, StyleSheet } = RN(); const P = palette(); const R = RX();
  const kids = p.children.filter(Boolean);
  const hair = StyleSheet?.hairlineWidth ?? 1;
  const items: any[] = [];
  kids.forEach((k: any, i: number) => {
    if (i > 0) items.push(h(View, { key: "d" + i, style: { height: hair, marginLeft: 16, backgroundColor: P.sep } }));
    items.push(h(R.Fragment, { key: "r" + i }, k));
  });
  return h(View, { style: { marginBottom: 22 } },
    p.title ? h(Text, { style: { color: P.muted, fontSize: 13, fontWeight: "700", marginBottom: 8, marginLeft: 6, textTransform: "uppercase", letterSpacing: 0.6 } }, p.title) : null,
    h(View, { style: { backgroundColor: P.card, borderRadius: 14, overflow: "hidden" } }, ...items),
    p.footer ? h(Text, { style: { color: P.muted, fontSize: 12.5, marginTop: 8, marginHorizontal: 8, lineHeight: 17 } }, p.footer) : null,
  );
}

export interface RowProps {
  title: string; subtitle?: string; value?: string; icon?: any; iconTint?: string; emoji?: string;
  onPress?: () => void; onLongPress?: () => void; chevron?: boolean; right?: any;
  accent?: boolean; destructive?: boolean; center?: boolean; lines?: number; mono?: boolean;
}

export function Row(p: RowProps) {
  const { View, Text, Pressable } = RN(); const P = palette();
  const color = p.destructive ? P.danger : p.accent ? P.accent : P.text;
  let icon: any = null;
  if (p.icon || p.emoji) {
    icon = h(View, { style: { width: 32, height: 32, borderRadius: 9, marginRight: 12, alignItems: "center", justifyContent: "center", backgroundColor: p.iconTint ?? P.accent } },
      p.icon ? h(p.icon, { size: 18, color: "#ffffff" }) : h(Text, { style: { fontSize: 16 } }, p.emoji));
  }
  return h(Pressable, {
    disabled: !p.onPress && !p.onLongPress,
    onPress: p.onPress, onLongPress: p.onLongPress,
    style: ({ pressed }: any) => ({ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, minHeight: 54, backgroundColor: pressed ? P.sep : "transparent" }),
  },
    icon,
    h(View, { style: { flex: 1, paddingVertical: 12, alignItems: p.center ? "center" : "stretch" } },
      h(Text, { style: { color, fontSize: p.mono ? 12 : 16, fontWeight: p.center || p.accent ? "600" : "500", fontFamily: p.mono ? "Menlo" : undefined } }, p.title),
      p.subtitle ? h(Text, { numberOfLines: p.lines ?? 2, style: { color: P.muted, fontSize: 13, marginTop: 2, lineHeight: 18 } }, p.subtitle) : null),
    p.value != null ? h(Text, { numberOfLines: 1, style: { color: P.muted, fontSize: 15, marginLeft: 10, maxWidth: "45%" } }, p.value) : null,
    p.right ?? null,
    p.chevron ? h(Text, { style: { color: P.muted, fontSize: 24, marginLeft: 8, marginTop: -2 } }, "›") : null,
  );
}

export function SwitchRow(p: RowProps & { on: boolean; onChange: (v: boolean) => void }) {
  const { Switch } = RN(); const P = palette();
  return Row({
    ...p,
    right: h(Switch, { value: p.on, onValueChange: p.onChange, trackColor: { true: P.accent, false: P.sep }, ios_backgroundColor: P.sep, thumbColor: "#ffffff" }),
  });
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

export function confirm(title: string, message: string, action: string, onConfirm: () => void, destructive = false) {
  alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: action, style: destructive ? "destructive" : "default", onPress: onConfirm }]);
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

export function openUrl(url: string) { try { RN()?.Linking?.openURL(url); } catch { /* ignore */ } }
