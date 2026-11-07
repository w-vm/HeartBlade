// Message Logger (HeartBlade plugin).
// Deleted messages stay in the chat with a small note, edited messages show what they said before, and both are kept in a log.
// Ignore bots, yourself, or specific users / channels / servers by ID (separate several with "-").

const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
const log = (m) => safe(() => hb.logger.log("[logger] " + m));
const R = hb.React;
const kit = safe(() => hb.ui.kit);

const CACHE_LIMIT = 2000;   // messages remembered while the app is open
const LOG_LIMIT = 500;      // entries kept in the log
const DEFAULTS = {
  ignoreBots: false, ignoreSelf: true, ignoreUsers: "", ignoreChannels: "", ignoreGuilds: "",
  label: "Deleted", showEditHistory: true, clock: "24",
  keepLog: true, autoClear: 0,
};
const cfg = (k) => { const v = hb.storage.get(k); return v === undefined ? DEFAULTS[k] : v; };
const setCfg = (k, v) => hb.storage.set(k, v);
const idSet = (text) => new Set(String(text || "").split(/[^0-9]+/).filter(Boolean));   // "123-456", "123, 456" and "123 456" all work

// ---------- Discord stores ----------
const isStub = (m) => safe(() => Object.prototype.hasOwnProperty.call(m, "$$loader") || Object.prototype.hasOwnProperty.call(m, "$$baseObject"), false);
const store = (name) => safe(() => hb.metro.findByStoreName(name));
const selfId = () => safe(() => store("AuthenticationStore").getId() || store("UserStore").getCurrentUser().id, null);
const guildOf = (cid) => safe(() => { const c = store("ChannelStore").getChannel(cid); return c.guild_id || c.guildId || null; }, null);
const guildName = (gid) => (gid ? safe(() => store("GuildStore").getGuild(gid).name, null) : null);
const channelName = (cid) => safe(() => { const c = store("ChannelStore").getChannel(cid); return c && (c.name || (c.rawRecipients && c.rawRecipients.map((r) => r.username).join(", ")) || "DM") || null; }, null);
const nameOf = (a) => (a && (a.global_name || a.globalName || a.username)) || "unknown";

// ---------- messages seen while the app is open ----------
const cache = new Map();   // id -> { id, channelId, guildId, content, authorId, author, bot, deleted, deletedAt, history: [] }
function remember(m, guildId, channelId) {
  if (!m || !m.id) return null;
  const prev = cache.get(m.id);
  const ch = m.channel_id || m.channelId || channelId || (prev && prev.channelId);
  const e = prev || { id: m.id, channelId: ch, guildId: null, content: "", authorId: null, author: "unknown", bot: false, deleted: false, deletedAt: 0, history: [] };
  e.channelId = ch;
  e.guildId = guildId || m.guild_id || e.guildId || guildOf(ch);
  if (typeof m.content === "string") e.content = m.content;
  if (m.author) { e.authorId = m.author.id || e.authorId; e.author = nameOf(m.author); e.bot = !!m.author.bot || !!m.author.system; }
  if (!prev) { cache.set(m.id, e); while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value); }
  return e;
}

function ignored(e) {
  if (!e) return true;
  if (cfg("ignoreBots") && e.bot) return true;
  if (cfg("ignoreSelf") && e.authorId && e.authorId === selfId()) return true;
  if (e.authorId && idSet(cfg("ignoreUsers")).has(String(e.authorId))) return true;
  if (e.channelId && idSet(cfg("ignoreChannels")).has(String(e.channelId))) return true;
  if (e.guildId && idSet(cfg("ignoreGuilds")).has(String(e.guildId))) return true;
  return false;
}

// ---------- how a kept message looks ----------
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
const oneLine = (t) => String(t).replace(/\s+/g, " ").trim();
const esc = (t) => String(t).replace(/([*_~`|\\>#@])/g, "\\$1");
const hms = (t) => {
  const d = new Date(t); const p = (n) => String(n).padStart(2, "0");
  if (cfg("clock") === "12") return p(d.getHours() % 12 || 12) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + " " + (d.getHours() < 12 ? "AM" : "PM");
  return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
};
function render(e) {
  const lines = [];
  if (cfg("showEditHistory")) for (const h of e.history.slice(-3)) lines.push("Edited at " + hms(h.at) + " · before: " + esc(clip(oneLine(h.old) || "(empty)", 120)));
  if (e.deleted) lines.push(cfg("label") + " at " + hms(e.deletedAt));
  const body = e.content || "";
  return lines.length ? (body ? body + "\n" : "") + lines.map((n) => "-# " + n).join("\n") : body;
}

// ---------- the log ----------
let bumpUI = () => {};
function addLog(kind, e, extra) {
  if (!cfg("keepLog")) return;
  const list = hb.storage.get("log", []);
  list.push(Object.assign({ kind, id: e.id, channelId: e.channelId, guildId: e.guildId, authorId: e.authorId, author: e.author, bot: e.bot, content: e.content, guild: guildName(e.guildId), channel: channelName(e.channelId), at: Date.now() }, extra || {}));
  while (list.length > LOG_LIMIT) list.shift();
  hb.storage.set("log", list);
  bumpUI();
}

// ---------- Discord's dispatcher ----------
let dispatcher = null;
function findDispatcher() {
  const has = (o) => safe(() => o && typeof o.dispatch === "function" && typeof o.subscribe === "function", false);
  const found = [];
  safe(() => hb.metro.findAll((m) => {
    if (!m || isStub(m)) return false;
    if (has(m)) found.push(m); else if (safe(() => m.default, null) && has(m.default)) found.push(m.default);
    return false;
  }));
  return found.find((d) => safe(() => d._actionHandlers || d._subscriptions || d.isDispatching !== undefined, false)) || found[0];
}

function handle(ev, orig) {
  const t = ev && ev.type;
  if (t === "MESSAGE_CREATE" && ev.message) { remember(ev.message, ev.guildId, ev.channelId); return orig(ev); }
  if (t === "LOAD_MESSAGES_SUCCESS" && Array.isArray(ev.messages)) { ev.messages.forEach((m) => remember(m, ev.guildId, ev.channelId)); return orig(ev); }
  if (t === "MESSAGE_UPDATE" && ev.message && ev.message.id) return orig(onUpdate(ev));
  if (t === "MESSAGE_DELETE" && ev.id) { const up = keptUpdate(ev.id, ev.guildId); return up ? orig(up) : orig(ev); }
  if (t === "MESSAGE_DELETE_BULK" && Array.isArray(ev.ids)) {
    const keep = [];
    for (const id of ev.ids) { const up = keptUpdate(id, ev.guildId); if (up) orig(up); else keep.push(id); }
    if (keep.length === 0) return;
    return orig(keep.length === ev.ids.length ? ev : Object.assign({}, ev, { ids: keep }));
  }
  return orig(ev);
}

// An edit: remember the old text and show it under the new one.
function onUpdate(ev) {
  const m = ev.message;
  const e = remember({ id: m.id, channel_id: m.channel_id }, ev.guildId, ev.channelId);
  if (!e || typeof m.content !== "string") return ev;
  if (ignored(e)) { e.content = m.content; return ev; }
  if (m.content !== e.content && !e.deleted) {
    const old = e.content;
    e.history.push({ old, at: Date.now() });
    if (e.history.length > 10) e.history.shift();
    e.content = m.content;
    addLog("edit", e, { old });
  } else e.content = m.content;
  return Object.assign({}, ev, { message: Object.assign({}, m, { content: render(e) }) });
}

// A delete: keep the message, turn the event into an update that adds the note. Returns that event, or null to let the delete through.
function keptUpdate(id, guildId) {
  const e = cache.get(id);
  if (!e || e.deleted) return null;
  if (guildId && !e.guildId) e.guildId = guildId;
  if (ignored(e)) return null;
  e.deleted = true; e.deletedAt = Date.now();
  addLog("delete", e);
  return { type: "MESSAGE_UPDATE", guildId: e.guildId || undefined, message: { id: e.id, channel_id: e.channelId, content: render(e) } };
}

function install(un) {
  dispatcher = findDispatcher();
  if (!dispatcher) { log("could not find Discord's dispatcher; nothing is logged"); return; }
  un.push(hb.patcher.instead(dispatcher, "dispatch", (args, orig) => {
    try { return handle(args[0], (ev) => orig(ev, ...args.slice(1))); }
    catch (err) { log("handler error: " + (err && err.message)); return orig(...args); }
  }));
  log("watching deleted and edited messages");
}

// ---------- settings ----------
const copy = (t) => { try { if (kit && kit.copy) return kit.copy(String(t), "Text"); } catch (e) { log("copy failed: " + (e && e.message)); } };
const act = (fn) => { try { fn(); } catch (e) { log("action failed: " + (e && e.message)); } };
const ask = (title, msg, ok) => new Promise((res) => safe(() => hb.ReactNative.Alert.alert(title, msg, [{ text: "Cancel", style: "cancel", onPress: () => res(false) }, { text: ok, style: "destructive", onPress: () => res(true) }])));
const ts = (t) => safe(() => { const d = new Date(t); const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + hms(t); }, "");
const logText = (l) => (l.kind === "edit" ? "Before: " + (l.old || "") + "\nAfter: " + (l.content || "") : l.content || "");   // what gets copied

function sheet(title, items) {
  const RN = hb.ReactNative; const AS = RN.ActionSheetIOS;
  const labels = items.map((i) => i.label).concat("Cancel");
  const d = items.findIndex((i) => i.destructive);
  if (AS && AS.showActionSheetWithOptions) AS.showActionSheetWithOptions(Object.assign({ title, options: labels, cancelButtonIndex: labels.length - 1 }, d >= 0 ? { destructiveButtonIndex: d } : {}), (i) => { const it = items[i]; if (it) act(it.run); });
  else RN.Alert.alert(title, undefined, items.map((i) => ({ text: i.label, style: i.destructive ? "destructive" : "default", onPress: () => act(i.run) })).concat({ text: "Cancel", style: "cancel" }));
}
let idsVer = 0;   // bumps when an ID list changes from outside its text box, so the box shows it
function toggleIgnore(k, id, what) {
  const set = idSet(cfg(k)); const on = !set.has(String(id));
  if (on) set.add(String(id)); else set.delete(String(id));
  setCfg(k, Array.from(set).join("-")); idsVer++; bumpUI();
  safe(() => hb.ui.alert(on ? "Ignored" : "No longer ignored", what));
}
const ignoreItems = (x) => {
  const has = (k, id) => idSet(cfg(k)).has(String(id));
  const out = [];
  if (x.authorId) out.push({ label: (has("ignoreUsers", x.authorId) ? "Stop ignoring " : "Ignore ") + "user: " + x.author, run: () => toggleIgnore("ignoreUsers", x.authorId, "User " + x.author) });
  if (x.channelId) out.push({ label: (has("ignoreChannels", x.channelId) ? "Stop ignoring" : "Ignore") + " this channel", run: () => toggleIgnore("ignoreChannels", x.channelId, "Channel " + (x.channel || x.channelId)) });
  if (x.guildId) out.push({ label: (has("ignoreGuilds", x.guildId) ? "Stop ignoring" : "Ignore") + " this server", run: () => toggleIgnore("ignoreGuilds", x.guildId, "Server " + (x.guild || x.guildId)) });
  return out;
};

function IdField(props) {
  const { TextInput } = hb.ReactNative; const P = kit.palette();
  const [v, setV] = R.useState(String(cfg(props.k) || ""));       // local copy: a controlled input must not depend on a re-render
  return R.createElement(TextInput, {
    value: v, onChangeText: (t) => { setV(t); setCfg(props.k, t); }, placeholder: "123456789-987654321", placeholderTextColor: P.muted,
    autoCapitalize: "none", autoCorrect: false, spellCheck: false, keyboardType: "numbers-and-punctuation", selectionColor: P.accent,
    style: { color: P.text, backgroundColor: P.input, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginTop: 8, fontFamily: "Menlo" },
  });
}

function useBump() {
  const [, force] = R.useState(0); const bump = () => force((n) => n + 1);
  R.useEffect(() => { bumpUI = bump; return () => { bumpUI = () => {}; }; }, []);
  return bump;
}

function LoggerSettings(props) {
  const { View } = hb.ReactNative; const { Group, Row, SwitchRow } = kit;
  const bump = useBump();
  const sw = (k, title, subtitle) => R.createElement(SwitchRow, { key: k, title, subtitle, on: !!cfg(k), onChange: (v) => { setCfg(k, v); bump(); } });
  const cycle = (k, title, options, subtitle) => R.createElement(Row, { key: k, title, subtitle, value: String((options.find((o) => o[0] === cfg(k)) || [0, cfg(k)])[1]), chevron: true, onPress: () => { const i = options.findIndex((o) => o[0] === cfg(k)); setCfg(k, options[(i + 1) % options.length][0]); bump(); } });
  const ids = (k, title) => R.createElement(Row, { key: k, title, extra: R.createElement(IdField, { k, key: k + ":" + idsVer }) });
  const count = hb.storage.get("log", []).length;
  return R.createElement(View, null,
    R.createElement(Group, { title: "Ignore", footer: "Several IDs: put a - between them, like 111-222. You can also long press an entry in the log to ignore its user, channel or server." }, [
      sw("ignoreBots", "Ignore bots"), sw("ignoreSelf", "Ignore my own messages"),
      ids("ignoreUsers", "Ignore these users"), ids("ignoreChannels", "Ignore these channels"), ids("ignoreGuilds", "Ignore these servers"),
    ]),
    R.createElement(Group, { title: "Look" }, [
      cycle("label", "Deleted label", [["Deleted", "Deleted"], ["Deleted message", "Deleted message"], ["Removed", "Removed"], ["Gone", "Gone"]]),
      sw("showEditHistory", "Show earlier text of edits"),
      cycle("clock", "Time format", [["24", "24-hour"], ["12", "12-hour"]]),
    ]),
    R.createElement(Group, { title: "Log", footer: "Messages are only caught while the app is open." }, [
      sw("keepLog", "Keep a log of deleted and edited messages"),
      cycle("autoClear", "Clear the log automatically", [[0, "Never"], [10, "Every 10 min"], [30, "Every 30 min"], [60, "Every hour"]]),
      R.createElement(Row, { key: "open", title: "Open the log", value: String(count), chevron: true, onPress: () => props.open && props.open("log", "Message log") }),
    ]));
}

// The full log, on its own page.
function LogPage() {
  const { View } = hb.ReactNative; const { Group, Row } = kit;
  const bump = useBump();
  const list = hb.storage.get("log", []).slice().reverse();
  const logMenu = (l) => sheet((l.kind === "delete" ? "Deleted" : "Edited") + " · " + l.author, [
    { label: l.kind === "edit" ? "Copy before and after" : "Copy text", run: () => copy(logText(l)) },
  ].concat(ignoreItems(l), [{ label: "Remove entry", destructive: true, run: () => { hb.storage.set("log", hb.storage.get("log", []).filter((x) => !(x.id === l.id && x.at === l.at && x.kind === l.kind))); bump(); } }]));
  const rows = list.length ? list.slice(0, 300).map((l, i) => R.createElement(Row, {
    key: l.id + ":" + l.at + ":" + i,
    title: (l.kind === "delete" ? "Deleted" : "Edited") + " · " + l.author + (l.bot ? " (bot)" : ""),
    subtitle: clip(oneLine(l.kind === "edit" ? "Before: " + (l.old || "") + "\nNow: " + (l.content || "") : l.content || "(no text)"), 220) + "\n" + ts(l.at) + " · " + (l.guild ? l.guild + " · #" + (l.channel || l.channelId) : (l.channel ? "DM · " + l.channel : "channel " + l.channelId)),
    lines: 6, onPress: () => act(() => copy(logText(l))), onLongPress: () => logMenu(l),
  })) : [R.createElement(Row, { key: "none", title: "Nothing logged yet", center: true })];
  return R.createElement(View, null,
    list.length ? R.createElement(Group, null, [R.createElement(Row, { key: "clear", title: "Clear the log", destructive: true, center: true, onPress: () => ask("Clear the log", "Remove all " + list.length + " entries?", "Clear").then((y) => { if (y) { hb.storage.set("log", []); bump(); } }) })]) : null,
    R.createElement(Group, { title: "Entries", footer: list.length ? "Tap to copy (edits copy the text before and after). Long press to ignore the user, channel or server, or to remove the entry." : undefined }, rows));
}

const undo = [];
return {
  onLoad() {
    safe(() => install(undo));
    // Auto-clear: wipes the stored log once the chosen time has passed since the last clear.
    let last = Date.now();
    const timer = setInterval(() => {
      const min = cfg("autoClear");
      if (!min) { last = Date.now(); return; }
      if (Date.now() - last >= min * 60000) { last = Date.now(); if ((hb.storage.get("log", []) || []).length) { hb.storage.set("log", []); bumpUI(); log("log cleared automatically"); } }
    }, 15000);
    undo.push(() => clearInterval(timer));
  },
  onUnload() { undo.splice(0).forEach((f) => safe(f)); cache.clear(); dispatcher = null; bumpUI = () => {}; },
  settings: kit ? LoggerSettings : undefined,
  pages: kit ? { log: LogPage } : undefined,
};
