// Message Logger 0.2.0 (HeartBlade plugin).
// Deleted messages stay visible (marked), edits show what the message said before, and everything can be kept in a log.
// Filters: bots, yourself, user / channel / server IDs (separate several with "-"), DMs only or servers only.

const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
const log = (m) => safe(() => hb.logger.log("[logger] " + m));
const R = hb.React;
const kit = safe(() => hb.ui.kit);

const DEFAULTS = {
  enabled: true, logDeletes: true, logEdits: true,
  ignoreBots: false, ignoreSelf: true,
  ignoreUsers: "", ignoreChannels: "", ignoreGuilds: "",
  scope: "all",                 // all | servers | dms
  strike: false, colorNotes: true, showTime: true,                // wrap deleted text in ~~strikethrough~~
  label: "Deleted",             // line added under a deleted message
  showEditHistory: true,
  keepLog: true, logLimit: 300, cacheLimit: 2000,
};
const cfg = (k) => { const v = hb.storage.get(k); return v === undefined ? DEFAULTS[k] : v; };
const setCfg = (k, v) => hb.storage.set(k, v);

// "123-456", "123, 456" and "123 456" all work.
const idSet = (text) => new Set(String(text || "").split(/[^0-9]+/).filter(Boolean));

// ---------- stores ----------
const isStub = (m) => safe(() => Object.prototype.hasOwnProperty.call(m, "$$loader") || Object.prototype.hasOwnProperty.call(m, "$$baseObject"), false);
const store = (name) => safe(() => hb.metro.findByStoreName(name));
const selfId = () => safe(() => store("AuthenticationStore").getId() || store("UserStore").getCurrentUser().id, null);
const guildOf = (channelId) => safe(() => store("ChannelStore").getChannel(channelId).guild_id || store("ChannelStore").getChannel(channelId).guildId || null, null);
const nameOf = (a) => (a && (a.global_name || a.globalName || a.username)) || "unknown";

// ---------- invisible tags: let the Text hook recognise a note and know which message it belongs to ----------
const DEL = "\u2063", EDT = "\u2064", END = "\u2062", DIG = ["\u200b", "\u200c", "\u200d", "\u2060"];
const TAG_RE = /^([\u2063\u2064])([\u200b\u200c\u200d\u2060]+)\u2062/;
const encSeq = (n) => { let t = ""; do { t = DIG[n % 4] + t; n = Math.floor(n / 4); } while (n > 0); return t; };
const decSeq = (t) => { let n = 0; for (const ch of t) n = n * 4 + DIG.indexOf(ch); return n; };
let seqN = 0; const bySeq = new Map();
const hms = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, "0"); return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()); };

// ---------- cache of messages we have seen ----------
const cache = new Map();   // id -> { id, channelId, guildId, content, authorId, author, bot, deleted, history: [] }
function remember(m, guildId, channelId) {
  if (!m || !m.id) return null;
  const prev = cache.get(m.id);
  const ch = m.channel_id || m.channelId || channelId || (prev && prev.channelId);
  const e = prev || { id: m.id, channelId: ch, guildId: null, content: "", authorId: null, author: "unknown", bot: false, deleted: false, deletedAt: 0, forced: false, history: [], seq: ++seqN };
  e.channelId = ch;
  e.guildId = guildId || m.guild_id || e.guildId || guildOf(ch);
  if (typeof m.content === "string") e.content = m.content;
  if (m.author) { e.authorId = m.author.id || e.authorId; e.author = nameOf(m.author); e.bot = !!m.author.bot || !!m.author.system; }
  if (!prev) { cache.set(m.id, e); bySeq.set(e.seq, e); const max = cfg("cacheLimit"); while (cache.size > max) { const k = cache.keys().next().value; const old = cache.get(k); if (old) bySeq.delete(old.seq); cache.delete(k); } }
  return e;
}

// ---------- filters ----------
function ignored(e) {
  if (!e) return true;
  if (cfg("ignoreBots") && e.bot) return true;
  if (cfg("ignoreSelf") && e.authorId && e.authorId === selfId()) return true;
  if (e.authorId && idSet(cfg("ignoreUsers")).has(String(e.authorId))) return true;
  if (e.channelId && idSet(cfg("ignoreChannels")).has(String(e.channelId))) return true;
  if (e.guildId && idSet(cfg("ignoreGuilds")).has(String(e.guildId))) return true;
  const scope = cfg("scope");
  if (scope === "servers" && !e.guildId) return true;
  if (scope === "dms" && e.guildId) return true;
  return false;
}

// ---------- what the message looks like ----------
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
const oneLine = (t) => String(t).replace(/\s+/g, " ").trim();
const esc = (t) => String(t).replace(/([*_~`|\\>#@])/g, "\\$1");
function render(e) {
  let body = e.content || "";
  if (e.deleted && cfg("strike") && body) body = "~~" + body.replace(/~~/g, "") + "~~";
  const tag = (k) => k + encSeq(e.seq) + END;
  const at = (t) => (cfg("showTime") ? " at " + hms(t) : "");
  const lines = [];
  if (cfg("showEditHistory")) for (const h of e.history.slice(-3)) lines.push(tag(EDT) + "Edited" + at(h.at) + " · before: " + esc(clip(oneLine(h.old) || "(empty)", 120)));
  if (e.deleted) lines.push(tag(DEL) + cfg("label") + at(e.deletedAt));
  return lines.length ? (body ? body + "\n" : "") + lines.map((n) => "-# " + n).join("\n") : body;
}

// ---------- the log ----------
function addLog(kind, e, extra) {
  if (!cfg("keepLog")) return;
  const list = hb.storage.get("log", []);
  list.push(Object.assign({ kind, id: e.id, channelId: e.channelId, guildId: e.guildId, authorId: e.authorId, author: e.author, bot: e.bot, content: e.content, at: Date.now() }, extra || {}));
  const max = cfg("logLimit"); while (list.length > max) list.shift();
  hb.storage.set("log", list);
  bumpUI();
}

// ---------- dispatcher ----------
function findDispatcher() {
  const has = (o) => safe(() => o && typeof o.dispatch === "function" && typeof o.subscribe === "function", false);
  const found = [];
  safe(() => hb.metro.findAll((m) => {
    if (!m || isStub(m)) return false;
    if (has(m)) found.push(m); else if (safe(() => m.default, null) && has(m.default)) found.push(m.default);
    return false;
  }));
  const best = found.find((d) => safe(() => d._actionHandlers || d._subscriptions || d.isDispatching !== undefined, false)) || found[0];
  log("dispatcher candidates: " + found.length + (best ? ", using " + (safe(() => Object.keys(best).slice(0, 8).join("/"), "?")) : ", none"));
  return best;
}

function handle(ev, orig) {
  const t = ev && ev.type;
  if (t === "MESSAGE_CREATE" && ev.message) { remember(ev.message, ev.guildId, ev.channelId); return orig(ev); }
  if (t === "LOAD_MESSAGES_SUCCESS" && Array.isArray(ev.messages)) { ev.messages.forEach((m) => remember(m, ev.guildId, ev.channelId)); return orig(ev); }
  if (t === "MESSAGE_UPDATE" && ev.message && ev.message.id) return orig(onUpdate(ev));
  if (t === "MESSAGE_DELETE" && ev.id) return onDelete(ev, orig);
  if (t === "MESSAGE_DELETE_BULK" && Array.isArray(ev.ids)) {
    const keep = [];
    for (const id of ev.ids) { const up = keptUpdate(id, ev.guildId); if (up) orig(up); else keep.push(id); }
    if (keep.length === 0) return;
    return orig(keep.length === ev.ids.length ? ev : Object.assign({}, ev, { ids: keep }));
  }
  return orig(ev);
}

// An edit: remember the old text, show it under the new one.
function onUpdate(ev) {
  const m = ev.message;
  const e = remember({ id: m.id, channel_id: m.channel_id }, ev.guildId, ev.channelId);
  if (!e || typeof m.content !== "string" || !cfg("enabled")) { if (e && typeof m.content === "string") e.content = m.content; return ev; }
  if (ignored(e)) { e.content = m.content; return ev; }
  if (cfg("logEdits") && m.content !== e.content && !e.deleted) {
    const old = e.content;
    e.history.push({ old, at: Date.now() });
    if (e.history.length > 10) e.history.shift();
    e.content = m.content;
    addLog("edit", e, { old });
  } else e.content = m.content;
  return Object.assign({}, ev, { message: Object.assign({}, m, { content: render(e) }) });
}

// A delete: keep the message and turn the event into an update that marks it. Returns that event, or null to let the delete through.
function keptUpdate(id, guildId) {
  const e = cache.get(id);
  if (!e || !cfg("enabled") || !cfg("logDeletes") || e.deleted || e.forced) return null;
  if (guildId && !e.guildId) e.guildId = guildId;
  if (ignored(e)) return null;
  e.deleted = true; e.deletedAt = Date.now();
  addLog("delete", e);
  return { type: "MESSAGE_UPDATE", guildId: e.guildId || undefined, message: { id: e.id, channel_id: e.channelId, content: render(e) } };
}
function onDelete(ev, orig) { const up = keptUpdate(ev.id, ev.guildId); return up ? orig(up) : orig(ev); }

let dispatcher = null;
let bypass = false;   // our own events (removing a kept message, hiding notes) go straight through
const send = (ev) => { bypass = true; try { dispatcher.dispatch(ev); } finally { bypass = false; } };

// ---------- tapping / colouring the notes ----------
const copy = (t) => safe(() => hb.ReactNative.Clipboard.setString(t));
function sheet(title, items) {
  const RN = hb.ReactNative; const AS = RN.ActionSheetIOS;
  const labels = items.map((i) => i.label).concat("Cancel");
  const d = items.findIndex((i) => i.destructive);
  if (AS && AS.showActionSheetWithOptions) AS.showActionSheetWithOptions(Object.assign({ title, options: labels, cancelButtonIndex: labels.length - 1 }, d >= 0 ? { destructiveButtonIndex: d } : {}), (i) => { const it = items[i]; if (it) safe(it.run); });
  else RN.Alert.alert(title, undefined, items.map((i) => ({ text: i.label, style: i.destructive ? "destructive" : "default", onPress: () => safe(i.run) })).concat({ text: "Cancel", style: "cancel" }));
}
let idsVer = 0;
function toggleIgnore(k, id, what) {
  const set = idSet(cfg(k)); const on = !set.has(String(id));
  if (on) set.add(String(id)); else set.delete(String(id));
  setCfg(k, Array.from(set).join("-")); idsVer++; bumpUI();
  safe(() => hb.ui.alert(on ? "Ignored" : "No longer ignored", what));
}
const ignoreItems = (x) => {
  const set = (k, id) => idSet(cfg(k)).has(String(id));
  const out = [];
  if (x.authorId) out.push({ label: (set("ignoreUsers", x.authorId) ? "Stop ignoring " : "Ignore ") + "user: " + x.author, run: () => toggleIgnore("ignoreUsers", x.authorId, "User " + x.author) });
  if (x.channelId) out.push({ label: (set("ignoreChannels", x.channelId) ? "Stop ignoring" : "Ignore") + " this channel", run: () => toggleIgnore("ignoreChannels", x.channelId, "Channel " + x.channelId) });
  if (x.guildId) out.push({ label: (set("ignoreGuilds", x.guildId) ? "Stop ignoring" : "Ignore") + " this server", run: () => toggleIgnore("ignoreGuilds", x.guildId, "Server " + x.guildId) });
  return out;
};
function noteMenu(e, kind) {
  if (!e) return safe(() => hb.ui.alert("Message Logger", "This message is no longer remembered."));
  const items = [];
  if (kind === "delete") {
    items.push({ label: "Remove from chat", destructive: true, run: () => { e.forced = true; send({ type: "MESSAGE_DELETE", id: e.id, channelId: e.channelId, guildId: e.guildId || undefined }); } });
    items.push({ label: "Copy text", run: () => copy(e.content) });
  } else {
    items.push({ label: "Copy earlier text", run: () => copy((e.history[e.history.length - 1] || {}).old || "") });
    items.push({ label: "Hide edit notes", run: () => { e.history = []; send({ type: "MESSAGE_UPDATE", guildId: e.guildId || undefined, message: { id: e.id, channel_id: e.channelId, content: render(e) } }); } });
  }
  sheet(kind === "delete" ? "Deleted message" : "Edited message", items.concat(ignoreItems(e)));
}
function patchText(un) {
  const T = safe(() => hb.ReactNative.Text, null);
  if (!T || typeof T.render !== "function") { log("text hook: RN.Text.render not found, notes are not coloured or tappable"); return; }
  un.push(hb.patcher.before(T, "render", (args) => {
    const p = args[0]; if (!p) return;
    const ch = p.children;
    const first = typeof ch === "string" ? ch : (Array.isArray(ch) && typeof ch[0] === "string" ? ch[0] : null);
    if (!first || (first[0] !== DEL && first[0] !== EDT)) return;
    const m = TAG_RE.exec(first); if (!m) return;
    const e = bySeq.get(decSeq(m[2])); const kind = m[1] === DEL ? "delete" : "edit";
    const clean = first.slice(m[0].length);
    const np = Object.assign({}, p, { children: typeof ch === "string" ? clean : [clean].concat(ch.slice(1)), onPress: () => noteMenu(e, kind), suppressHighlighting: true });
    if (cfg("colorNotes")) np.style = [p.style, { color: kind === "delete" ? "#f23f43" : "#f0b232" }];
    return [np, args[1]];
  }));
  log("text hook on");
}

function install(un) {
  dispatcher = findDispatcher();
  if (!dispatcher) { log("could not find Discord's dispatcher; nothing is logged"); return; }
  un.push(hb.patcher.instead(dispatcher, "dispatch", (args, orig) => {
    if (bypass) return orig(...args);
    try { return handle(args[0], (ev) => orig(ev, ...args.slice(1))); }
    catch (err) { log("handler error: " + (err && err.message)); return orig(...args); }
  }));
  safe(() => patchText(un));
  log("watching deleted and edited messages");
}

// ---------- settings page ----------
let bumpUI = () => {};
const ts = (t) => safe(() => new Date(t).toISOString().replace("T", " ").slice(0, 16), "");
const ask = (title, msg, ok, destructive) => new Promise((res) => safe(() => hb.ReactNative.Alert.alert(title, msg, [{ text: "Cancel", style: "cancel", onPress: () => res(false) }, { text: ok, style: destructive ? "destructive" : "default", onPress: () => res(true) }])));

function IdField(props) {
  const { TextInput } = hb.ReactNative; const P = kit.palette();
  const [v, setV] = R.useState(String(cfg(props.k) || ""));       // local copy: a controlled input must not depend on a re-render
  return R.createElement(TextInput, {
    value: v, onChangeText: (t) => { setV(t); setCfg(props.k, t); }, placeholder: "123456789-987654321", placeholderTextColor: P.muted,
    autoCapitalize: "none", autoCorrect: false, spellCheck: false, keyboardType: "numbers-and-punctuation", selectionColor: P.accent,
    style: { color: P.text, backgroundColor: P.input, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 8, fontFamily: "Menlo" },
  });
}

function LoggerSettings() {
  const { View } = hb.ReactNative; const { Group, Row, SwitchRow } = kit;
  const [, force] = R.useState(0); const bump = () => force((n) => n + 1);
  R.useEffect(() => { bumpUI = bump; return () => { bumpUI = () => {}; }; }, []);
  const sw = (k, title, subtitle) => R.createElement(SwitchRow, { key: k, title, subtitle, on: !!cfg(k), onChange: (v) => { setCfg(k, v); bump(); } });
  const cycle = (k, title, options, subtitle) => R.createElement(Row, { key: k, title, subtitle, value: String((options.find((o) => o[0] === cfg(k)) || [0, cfg(k)])[1]), chevron: true, onPress: () => { const i = options.findIndex((o) => o[0] === cfg(k)); setCfg(k, options[(i + 1) % options.length][0]); bump(); } });
  const ids = (k, title, subtitle) => R.createElement(Row, { key: k, title, subtitle, extra: R.createElement(IdField, { k, key: k + ":" + idsVer }) });
  const list = hb.storage.get("log", []).slice().reverse().slice(0, 40);
  
  const logMenu = (l) => sheet((l.kind === "delete" ? "Deleted" : "Edited") + " · " + l.author, [
    { label: "Copy text", run: () => copy(l.kind === "edit" ? l.old || "" : l.content || "") },
  ].concat(ignoreItems(l), [{ label: "Remove entry", destructive: true, run: () => { hb.storage.set("log", hb.storage.get("log", []).filter((x) => !(x.id === l.id && x.at === l.at))); bump(); } }]));

  const entries = list.length ? list.map((l, i) => R.createElement(Row, {
    key: l.id + ":" + l.at + ":" + i,
    title: (l.kind === "delete" ? "Deleted" : "Edited") + " · " + l.author + (l.bot ? " (bot)" : ""),
    subtitle: clip(oneLine(l.kind === "edit" ? "Before: " + (l.old || "") + "\nNow: " + (l.content || "") : l.content || "(no text)"), 220) + "\n" + ts(l.at) + " · channel " + l.channelId,
    lines: 6, onPress: () => { copy(l.kind === "edit" ? l.old || "" : l.content || ""); safe(() => hb.ui.alert("Copied", "The message text was copied.")); }, onLongPress: () => logMenu(l),
  })) : [R.createElement(Row, { key: "none", title: "Nothing logged yet", center: true })];

  return R.createElement(View, null,
    R.createElement(Group, { title: "Logger", footer: "Deleted messages stay in the chat with a label. Edited messages show their earlier text." }, [
      sw("enabled", "Enabled"), sw("logDeletes", "Keep deleted messages"), sw("logEdits", "Track edits"),
    ]),
    R.createElement(Group, { title: "Ignore", footer: "Several IDs: put a - between them, like 111-222. Tip: long press a user or channel in Discord and copy its ID (Developer Mode must be on)." }, [
      sw("ignoreBots", "Ignore bots"), sw("ignoreSelf", "Ignore my own messages"),
      cycle("scope", "Where to log", [["all", "Everywhere"], ["servers", "Servers only"], ["dms", "DMs only"]]),
      ids("ignoreUsers", "Ignore these users"), ids("ignoreChannels", "Ignore these channels"), ids("ignoreGuilds", "Ignore these servers"),
    ]),
    R.createElement(Group, { title: "Look" }, [
      sw("colorNotes", "Colour the notes", "Deleted in red, edited in amber. Tap a note in the chat for options."), sw("showTime", "Show the time in notes"),
      sw("strike", "Strike through deleted text"), sw("showEditHistory", "Show earlier text of edits"),
      cycle("label", "Deleted label", [["Deleted", "Deleted"], ["Deleted message", "Deleted message"], ["Removed", "Removed"], ["Gone", "Gone"]]),
    ]),
    R.createElement(Group, { title: "Storage" }, [
      sw("keepLog", "Keep a log of deleted and edited messages"),
      cycle("logLimit", "Log size", [[100, "100"], [300, "300"], [1000, "1000"]]),
      cycle("cacheLimit", "Messages remembered", [[500, "500"], [2000, "2000"], [5000, "5000"]], "Only messages seen while the app is open can be recovered."),
    ]),
    R.createElement(Group, { title: "Log", footer: list.length ? "Tap to copy. Long press to ignore the user, channel or server, or remove the entry." : undefined, headerRight: list.length ? R.createElement(kit.HeaderButton, { label: "Clear", danger: true, onPress: () => ask("Clear log", "Remove every logged message?", "Clear", true).then((y) => { if (y) { hb.storage.set("log", []); bump(); } }) }) : null }, entries));
}

const undo = [];
return {
  onLoad() {
    // The message cache is session-only; the log is stored on the device.
    safe(() => install(undo));
  },
  onUnload() {
    undo.splice(0).forEach((f) => safe(f));
    cache.clear(); dispatcher = null; bumpUI = () => {};
  },
  settings: kit ? LoggerSettings : undefined,
};
