// Account Manager v0.3.1 (HeartBlade plugin): /token, /login, encrypted account switcher.

const Vault = (() => {
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  function sha256(data) {
    const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const len = data.length; const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(data); padded[len] = 0x80; const bits = len * 8; const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000)); dv.setUint32(padded.length - 4, bits >>> 0);
    const w = new Uint32Array(64);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25); const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0; const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    const out = new Uint8Array(32); const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]); return out;
  }
  function concat(...parts) { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
  function hmac(key, msg) { if (key.length > 64) key = sha256(key); const ipad = new Uint8Array(64), opad = new Uint8Array(64); ipad.fill(0x36); opad.fill(0x5c); for (let i = 0; i < key.length; i++) { ipad[i] ^= key[i]; opad[i] ^= key[i]; } return sha256(concat(opad, sha256(concat(ipad, msg)))); }
  function utf8Encode(str) { const out = []; for (const ch of str) { let c = ch.codePointAt(0); if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); } return Uint8Array.from(out); }
  function utf8Decode(bytes) { let s = ""; for (let i = 0; i < bytes.length; ) { const b = bytes[i++]; let c; if (b < 0x80) c = b; else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[i++] & 63); else if (b < 0xf0) { c = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63); } else { c = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63); } s += String.fromCodePoint(c); } return s; }
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64enc(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 3) { const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0); s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]; s += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "="; s += i + 2 < bytes.length ? B64[n & 63] : "="; } return s; }
  function b64dec(str) { const clean = str.replace(/=+$/, ""); const out = new Uint8Array(Math.floor((clean.length * 3) / 4)); let o = 0, acc = 0, bits = 0; for (const ch of clean) { const v = B64.indexOf(ch); if (v < 0) throw new Error("vault: bad base64"); acc = (acc << 6) | v; bits += 6; if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; } } return out; }
  function randomBytes(n) { const c = globalThis.crypto; if (!c || typeof c.getRandomValues !== "function") throw new Error("vault: no secure random"); const out = new Uint8Array(n); c.getRandomValues(out); return out; }
  function ctEqual(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
  function keystream(encKey, nonce, length) { const out = new Uint8Array(Math.ceil(length / 32) * 32); for (let ctr = 0; ctr * 32 < length; ctr++) { const c = new Uint8Array([(ctr >>> 24) & 255, (ctr >>> 16) & 255, (ctr >>> 8) & 255, ctr & 255]); out.set(hmac(encKey, concat(nonce, c)), ctr * 32); } return out.slice(0, length); }
  const PREFIX = "v1.";
  function seal(encKey, macKey, plaintext) { const salt = randomBytes(16), nonce = randomBytes(16); const pt = utf8Encode(plaintext); const ks = keystream(encKey, nonce, pt.length); const ct = new Uint8Array(pt.length); for (let i = 0; i < pt.length; i++) ct[i] = pt[i] ^ ks[i]; const tag = hmac(macKey, concat(utf8Encode(PREFIX), salt, nonce, ct)); return PREFIX + b64enc(concat(salt, nonce, ct, tag)); }
  function open(encKey, macKey, blob) { if (typeof blob !== "string" || !blob.startsWith(PREFIX)) throw new Error("vault: unknown format"); const raw = b64dec(blob.slice(PREFIX.length)); if (raw.length < 64) throw new Error("vault: truncated"); const salt = raw.slice(0, 16), nonce = raw.slice(16, 32), ct = raw.slice(32, raw.length - 32), tag = raw.slice(raw.length - 32); if (!ctEqual(hmac(macKey, concat(utf8Encode(PREFIX), salt, nonce, ct)), tag)) throw new Error("vault: corrupted"); const ks = keystream(encKey, nonce, ct.length); const pt = new Uint8Array(ct.length); for (let i = 0; i < pt.length; i++) pt[i] = ct[i] ^ ks[i]; return utf8Decode(pt); }
  function create(keyB64) { let key = keyB64 ? b64dec(keyB64) : randomBytes(32); const encKey = hmac(key, utf8Encode("hb-enc")), macKey = hmac(key, utf8Encode("hb-mac")); return { keyB64: b64enc(key), encrypt: (text) => seal(encKey, macKey, text), decrypt: (blob) => open(encKey, macKey, blob), }; }
  return { create };
})();

const RN = hb.ReactNative;
const R = hb.React;
const API = "https://discord.com/api/v9";
const CLIP_CLEAR_MS = 60 * 1000;
const BOT_ID = "94945620787200001"; // snowflake date = 2015-09-20 (earliest year Discord allows) -> "Member Since"
const BOT_NAME = "HeartBlade";
const DEBUG = true; // shows a one-time alert with profile patch status; set false when done
const GOLD = "#F5D63D"; // Shinobu yellow (chat name color)
const PROFILE_PRIMARY = 0xF5D63D; // profile theme colors (edit to match the gif)
const PROFILE_SECONDARY = 0x8A6A12;
const BOT_BIO = "Kakaka! Made by my master @u6oa\nhttps://discord.com/users/233320628235665408";
const BIRTH_MS = Date.UTC(1407, 8, 20); // client-side spoof of "Member Since": Sep 20, 1407
const BOT_BANNER = "https://images.steamusercontent.com/ugc/991240935447261386/12C1E71B9C0C1415ACBFF4263EA5855568BC62D4/?imw=1200&imh=1200&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=false";
const BOT_AVATAR = "https://raw.githubusercontent.com/w-vm/HeartBlade/main/plugins/accounts/avatar.gif";

const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
const log = (m) => safe(() => hb.logger.log("[accounts] " + m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kit = safe(() => hb.ui.kit);

const secrets = new Set();
const scrub = (s) => { let t = String(s); for (const x of secrets) if (x && t.includes(x)) t = t.split(x).join("***"); return t; };
const track = (s) => { if (s) secrets.add(s); return s; };
const say = (title, msg) => safe(() => RN.Alert.alert(title, scrub(msg)));
const ask = (title, msg, secure) => new Promise((resolve) => { try { RN.Alert.prompt(title, msg, [ { text: "Cancel", style: "cancel", onPress: () => resolve(null) }, { text: "OK", onPress: (v) => resolve(typeof v === "string" ? v.trim() : "") }, ], secure ? "secure-text" : "plain-text"); } catch (e) { resolve(null); } });
const confirmAsk = (title, msg, okLabel, destructive) => new Promise((resolve) => { RN.Alert.alert(title, msg, [ { text: "Cancel", style: "cancel", onPress: () => resolve(false) }, { text: okLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) }, ]); });

const isStub = (m) => safe(() => Object.prototype.hasOwnProperty.call(m, "$$loader") || Object.prototype.hasOwnProperty.call(m, "$$baseObject"), false);
const hasFn = (m, k) => safe(() => typeof Object.getOwnPropertyDescriptor(m, k).value === "function", false);
const findMod = (pred) => safe(() => { const r = hb.metro.findAll((m) => m && !isStub(m) && safe(() => pred(m), false)); return Array.isArray(r) ? r[0] : undefined; }, undefined);
const authStore = () => safe(() => hb.metro.findByStoreName("AuthenticationStore"));
const authActions = () => findMod((m) => hasFn(m, "loginToken") && hasFn(m, "switchAccountToken"));
const commandsMod = () => findMod((m) => hasFn(m, "getBuiltInCommands")) || safe(() => hb.metro.findByProps("getBuiltInCommands"));
const currentToken = () => safe(() => authStore().getToken());
const currentId = () => safe(() => authStore().getId());

const store = { get: (k) => { const v = safe(() => hb.storage.get(k), undefined); return v === undefined ? null : v; }, set: (k, v) => safe(() => hb.storage.set(k, v)), };
const vault = (() => { const v = safe(() => Vault.create(store.get("vk"))); if (v && v.keyB64 !== store.get("vk")) store.set("vk", v.keyB64); return v; })();
const listAccounts = () => { const a = store.get("accounts"); return Array.isArray(a) ? a : []; };
const readTokens = () => safe(() => { const b = store.get("tokens"); return b ? JSON.parse(vault.decrypt(b)) : {}; }, {});
const writeTokens = (o) => store.set("tokens", vault.encrypt(JSON.stringify(o)));
function saveAccount(token, user) { const tokens = readTokens(); tokens[user.id] = token; writeTokens(tokens); const rest = listAccounts().filter((a) => a.id !== user.id); rest.push({ id: user.id, name: user.name, avatar: user.avatar || null }); store.set("accounts", rest); }
function removeAccount(id) { const tokens = readTokens(); delete tokens[id]; writeTokens(tokens); store.set("accounts", listAccounts().filter((a) => a.id !== id)); }
const avatarUrl = (a) => a.avatar ? "https://cdn.discordapp.com/avatars/" + a.id + "/" + a.avatar + ".png?size=96" : "https://cdn.discordapp.com/embed/avatars/" + (Number(String(a.id).slice(-1)) % 5) + ".png";

async function validateToken(raw) {
  const token = String(raw || "").trim().replace(/^"|"$/g, "");
  if (!token || /\s/.test(token) || token.length < 20 || token.length > 200) return { ok: false, reason: "Invalid token." };
  track(token);
  try {
    const r = await fetch(API + "/users/@me", { headers: { Authorization: token } });
    if (r.status === 401) return { ok: false, reason: "Discord rejected this token." };
    if (r.status === 429) return { ok: false, reason: "Rate limited." };
    if (!r.ok) return { ok: false, reason: "Error (HTTP " + r.status + ")." };
    const u = await r.json();
    if (!u || !u.id) return { ok: false, reason: "Unexpected reply." };
    return { ok: true, token, user: { id: String(u.id), name: u.global_name || u.username || String(u.id), avatar: u.avatar || null } };
  } catch (e) { return { ok: false, reason: "Network error." }; }
}

async function switchTo(token) {
  const v = await validateToken(token);
  if (!v.ok) { say("Cannot switch", v.reason); return false; }
  const act = authActions();
  if (!act) { say("Cannot switch", "Login module not found."); return false; }
  const mode = store.get("mode") === "switchAccountToken" ? "switchAccountToken" : "loginToken";
  if (currentId() === v.user.id) { say("Account Manager", v.user.name + " is already active."); return true; }
  try { await Promise.resolve(act[mode](v.token)); }
  catch (e) { say("Switch failed", "Error: " + scrub(e && e.message)); return false; }
  await sleep(2500);
  if (currentId() !== v.user.id) { say("Switch unclear", "Did not switch to " + v.user.name + "."); return false; }
  log("switched account via " + mode);
  return v;
}

async function addByToken() { const t = await ask("Add account", "Paste the account token.", true); if (!t) return false; const v = await validateToken(t); if (!v.ok) { say("Not added", v.reason); return false; } saveAccount(v.token, v.user); say("Account Manager", v.user.name + " added."); return true; }
async function saveCurrent() { const v = await validateToken(track(currentToken())); if (!v.ok) { say("Not saved", v.reason); return false; } saveAccount(v.token, v.user); return true; }

let nativeUnpatch = null;
function setNative(on) {
  safe(() => { nativeUnpatch && nativeUnpatch(); }); nativeUnpatch = null; store.set("native", !!on); if (!on) return;
  const un = [];
  safe(() => { const m = hb.metro.findByProps("getCanUseMultiAccountMobile"); un.push(hb.patcher.after(m, "getCanUseMultiAccountMobile", () => true)); });
  safe(() => { const s = hb.metro.findByStoreName("MultiAccountStore"); Object.defineProperty(s, "canUseMultiAccountNotifications", { get: () => true, configurable: true }); un.push(() => { delete s.canUseMultiAccountNotifications; }); });
  nativeUnpatch = () => un.forEach((f) => safe(f));
}

// ---------- /token : plain ephemeral message (long-press -> Copy Text works) ----------
const copyText = (text) => { RN.Clipboard.setString(text); setTimeout(async () => { try { const now = await RN.Clipboard.getString(); if (now === text) RN.Clipboard.setString(""); } catch (e) {} }, CLIP_CLEAR_MS); };

const SHINOBU_LINE = "Hand it to no soul, lest they wear thy face\nand speak in thy name.";

function sendLocal(channelId, content) {
  const maker = findMod((m) => hasFn(m, "createBotMessage"));
  const recv = findMod((m) => hasFn(m, "receiveMessage") && hasFn(m, "sendMessage"));
  if (!maker || !recv) return false;
  const msg = maker.createBotMessage({ channelId, content, embeds: [] });
  msg.colorString = GOLD;
  msg.member = Object.assign({}, msg.member, { colorString: GOLD, nick: BOT_NAME });
  msg.flags = 64; // EPHEMERAL -> "Only you can see this message"
  msg.author = Object.assign({}, msg.author, { id: BOT_ID, username: BOT_NAME, globalName: BOT_NAME, global_name: BOT_NAME, avatar: "hb", discriminator: "0", bot: true });
  recv.receiveMessage(channelId, msg);
  return true;
}

function cmdToken(ctx) {
  const t = track(currentToken());
  const ch = safe(() => ctx.channel.id);
  if (!t) return say("Token", "Could not read token.");
  const ok = ch && safe(() => sendLocal(ch, "||" + t + "||\n" + SHINOBU_LINE), false);
  if (!ok) { copyText(t); say("Token", "Copied (cleared after 60s)."); }
}

// ---------- bot avatar ----------
const isBotUri = (u) => typeof u === "string" && u.indexOf(BOT_ID) !== -1 && u.indexOf(BOT_AVATAR) === -1 && u.indexOf("steamusercontent") === -1;
const botUriFor = (u) => (String(u).indexOf("/banners/") !== -1 ? BOT_BANNER : BOT_AVATAR);
const fixProps = (p) => { const s = p && fixSource(p.source); if (!s) return null; return Object.assign({}, p, { source: s, resizeMode: "cover", style: [p.style, { resizeMode: "cover" }] }); };
const fixSource = (src) => { if (!src) return null; if (Array.isArray(src)) { const i = src.findIndex((x) => x && isBotUri(x.uri)); if (i < 0) return null; const c = src.slice(); c[i] = Object.assign({}, c[i], { uri: botUriFor(c[i].uri) }); return c; } return isBotUri(src.uri) ? Object.assign({}, src, { uri: botUriFor(src.uri) }) : null; };
function patchImage(un, host, key) { let ok = false; safe(() => { const target = host[key]; if (target && typeof target.render === "function") { un.push(hb.patcher.before(target, "render", (args) => { const np = fixProps(args[0]); if (np) return [np, args[1]]; })); ok = true; } else if (typeof target === "function") { un.push(hb.patcher.before(host, key, (args) => { const np = fixProps(args[0]); if (np) return [np].concat(args.slice(1)); })); ok = true; } }); return ok; }
function patchAvatar(un) { if (!BOT_AVATAR) return; const names = { getUserAvatarURL: "url", getAvatarURL: "url", getUserAvatarSource: "src", getAvatarSource: "src" }; for (const n of Object.keys(names)) { const m = findMod((x) => hasFn(x, n)); if (!m) continue; safe(() => un.push(hb.patcher.after(m, n, (args, ret) => { if (args[0] && args[0].id === BOT_ID) return names[n] === "src" ? { uri: BOT_AVATAR } : BOT_AVATAR; }))); } const img = patchImage(un, RN, "Image"); log("avatar hooks: image=" + img); }

// ---------- bot profile: banner + colors ----------
function patchProfile(un) {
  const st = safe(() => hb.metro.findByStoreName("UserProfileStore"));
  const targets = []; if (st) { targets.push(st); const p = safe(() => Object.getPrototypeOf(st)); if (p && p !== Object.prototype) targets.push(p); }
  let hooked = 0;
  for (const t of targets) for (const fn of ["getUserProfile", "getGuildMemberProfile"]) {
    if (typeof t[fn] !== "function") continue;
    safe(() => { un.push(hb.patcher.after(t, fn, (args, ret) => {
      if (args[0] !== BOT_ID) return;
      return Object.assign({}, ret || {}, { userId: BOT_ID, banner: "hb", accentColor: PROFILE_PRIMARY, themeColors: [PROFILE_PRIMARY, PROFILE_SECONDARY], bio: BOT_BIO });
    })); hooked++; });
  }
  const names = { getUserBannerURL: "url", getBannerURL: "url", getUserBannerSource: "src", getBannerSource: "src" };
  let banners = 0;
  for (const n of Object.keys(names)) {
    const m = findMod((x) => hasFn(x, n)); if (!m) continue;
    safe(() => { un.push(hb.patcher.after(m, n, (args, ret) => {
      const a = args[0];
      if (a && (a.id === BOT_ID || a.userId === BOT_ID)) return names[n] === "src" ? { uri: BOT_BANNER } : BOT_BANNER;
    })); banners++; });
  }
  let authorHooks = 0;
  for (const n of ["getMessageAuthor", "useMessageAuthor", "getAuthor"]) {
    const m = findMod((x) => hasFn(x, n)); if (!m) continue;
    safe(() => { un.push(hb.patcher.after(m, n, (args, ret) => {
      const a = ret && (ret.author || ret);
      if (a && (a.id === BOT_ID || (ret.author && ret.author.id === BOT_ID))) return Object.assign({}, ret, { colorString: GOLD, nickname: BOT_NAME });
    })); authorHooks++; });
  }
  const dateHooks = safe(() => patchBirthDate(un), 0);
  const msg = "date hooks: " + dateHooks + ", profile store: " + (st ? "found" : "NOT found") + ", hooks: " + hooked + ", banner modules: " + banners + ", author hooks: " + authorHooks;
  log(msg);
  if (DEBUG) safe(() => setTimeout(() => say("HeartBlade debug", msg), 3000));
}

// ---------- client-side "Member Since" spoof ----------
function patchBirthDate(un) {
  const names = ["extractTimestamp", "getCreatedAtDate", "getCreatedAt", "extractCreatedAt"];
  let n = 0;
  const mods = safe(() => hb.metro.findAll((m) => m && !isStub(m) && names.some((k) => hasFn(m, k))), []) || [];
  for (const m of mods) for (const k of names) {
    if (!hasFn(m, k)) continue;
    safe(() => { un.push(hb.patcher.after(m, k, (args, ret) => {
      const a = args[0]; const id = a && typeof a === "object" ? a.id : a;
      if (String(id) !== BOT_ID) return;
      if (ret instanceof Date) return new Date(BIRTH_MS);
      if (typeof ret === "number") return BIRTH_MS;
    })); n++; });
  }
  return n;
}

let hbOpenAccounts = () => {};

const mkCmd = (name, description, options, execute) => ({ name, untranslatedName: name, displayName: name, description, untranslatedDescription: description, displayDescription: description, applicationId: "-1", inputType: 1, type: 1, options: options.map((o) => ({ name: o.name, untranslatedName: o.name, displayName: o.name, description: o.description, untranslatedDescription: o.description, displayDescription: o.description, required: !!o.required, type: o.type || 3, choices: [], autocomplete: false })), execute });
const argOf = (args, name) => safe(() => Array.isArray(args) ? (args.find((x) => x.name === name) || {}).value : args && args[name]);

const commands = [
  mkCmd("accounts", "Open Account Manager", [], () => { if (hbOpenAccounts) hbOpenAccounts(); else say("Account Manager", "Go to HeartBlade Settings to open it."); }),
  mkCmd("token", "Show your token", [], (args, ctx) => { safe(() => cmdToken(ctx)); }),
  mkCmd("login", "Log in with token", [{ name: "token", description: "Token", required: true, type: 3 }], (args) => { (async () => { const res = await switchTo(argOf(args, "token")); if (res && res !== true) { saveAccount(res.token, res.user); say("Account Manager", "Switched to " + res.user.name + " and saved."); } })().catch((e) => say("Error", scrub(e && e.message))); }),
];

function registerCommands(un) {
  const mod = commandsMod(); if (!mod) { log("commands module not found!"); return; }
  let next = -1000; commands.forEach((c, i) => { c.id = String(next - i); });
  un.push(hb.patcher.after(mod, "getBuiltInCommands", (args, res) => {
    if (!Array.isArray(res)) return;
    const t = args[0];
    const mine = commands.filter((c) => !res.includes(c) && (Array.isArray(t) ? t.includes(c.type) : t === undefined || t === null || c.type === t));
    return mine.length ? res.concat(mine) : undefined;
  }));
  log("commands registered: " + commands.map((c) => "/" + c.name).join(", "));
}

function AccountsContent(props) {
  try {
    const { View, Text, Image } = RN; const { Group, Row, SwitchRow } = kit;
    const [, set] = R.useState(0); const bump = () => set((n) => n + 1); const close = props && props.onClose; const cur = currentId(); const accounts = listAccounts();
    const rows = accounts.map((a) => R.createElement(Row, { key: a.id, title: a.name, subtitle: a.id === cur ? "Active" : undefined, left: R.createElement(Image, { source: { uri: avatarUrl(a) }, style: { width: 34, height: 34, borderRadius: 17 } }), right: a.id === cur ? R.createElement(Text, { style: { color: kit.palette().ok, fontSize: 18 } }, "✓") : undefined, onPress: a.id === cur ? undefined : () => { Promise.resolve(confirmAsk("Switch", "Switch to " + a.name + "?", "Switch")).then(async (yes) => { if (!yes) return; const t = readTokens()[a.id]; if (!t) return say("Missing token", "Add again."); const r = await switchTo(t); if (r) { bump(); if (close) close(); } }); }, onLongPress: () => confirmAsk("Remove " + a.name + "?", "Remove from list?", "Remove", true).then((yes) => { if (yes) { removeAccount(a.id); bump(); } }), }));
    return R.createElement(View, null,
      R.createElement(Group, { title: "Accounts", footer: "Tap to switch. Long press to remove. Tokens are encrypted." }, rows.length ? rows : [R.createElement(Row, { key: "none", title: "No accounts yet", subtitle: "Use Save or Add below.", center: true })]),
      R.createElement(Group, { title: "Add" }, [
          R.createElement(Row, { key: "cur", title: "Save current account", chevron: true, onPress: () => saveCurrent().then((ok) => { if (ok) bump(); }) }),
          R.createElement(Row, { key: "tok", title: "Add with token", chevron: true, onPress: () => addByToken().then((ok) => { if (ok) bump(); }) }),
          R.createElement(SwitchRow, { key: "nat", title: "Native multi-account", subtitle: "Enable email/password login.", on: !!store.get("native"), onChange: (v) => { setNative(v); if (v) say("Manager", "Native login enabled."); } }),
      ]));
  } catch(e) { return R.createElement(RN.Text, { style: { color: "red", padding: 20 } }, "Error loading UI."); }
}

function AccountsModalEntry() {
  try {
    const { View, Text, Modal, Pressable } = RN; const { Group, Row } = kit;
    const [open, setOpen] = R.useState(false);
    const P = kit.palette(); const cur = listAccounts().find((a) => a.id === currentId());

    R.useEffect(() => {
        hbOpenAccounts = () => setOpen(true);
        return () => { hbOpenAccounts = () => {}; };
    }, []);

    return R.createElement(View, { style: { paddingHorizontal: 16, marginTop: 12 } },
      R.createElement(Group, null, [R.createElement(Row, { key: "am", title: "Account Manager", subtitle: cur ? cur.name : "Switch or add accounts", chevron: true, onPress: () => setOpen(true) })]),
      R.createElement(Modal, { visible: open, animationType: "slide", presentationStyle: "pageSheet", onRequestClose: () => setOpen(false) },
        R.createElement(View, { style: { flex: 1, backgroundColor: P.bg } },
          R.createElement(View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 } },
            R.createElement(Text, { style: { color: P.text, fontSize: 20, fontWeight: "700" } }, "Account Manager"),
            R.createElement(Pressable, { onPress: () => setOpen(false), hitSlop: 12 }, R.createElement(Text, { style: { color: P.accent, fontSize: 17, fontWeight: "600" } }, "Done"))),
          R.createElement(kit.Screen, { children: [R.createElement(AccountsContent, { key: "c", onClose: () => setOpen(false) })] }))))
  } catch(e) { return null; }
}

const safeStringify = (obj) => {
    try {
        const seen = new WeakSet();
        return JSON.stringify(obj, (k, v) => {
            if (typeof v === "object" && v !== null) {
                if (seen.has(v)) return "[Circular]";
                seen.add(v);
            }
            if (typeof v === "function") return "[Function]";
            return v;
        });
    } catch(e) { return ""; }
};

let sheetLogged = false;
const isTargetSheet = (props) => {
    if (!props) return false;
    try {
        const str = safeStringify(props);
        return str.includes("Change Online Status") || str.includes("Invisible") || str.includes("Set a custom status") || str.includes("تغيير حالة الاتصال");
    } catch(e) { return false; }
};

function patchSheetUI(un) {
  const inject = (args) => {
    try {
        const type = args[0]; const props = args[1];
        if (!props || props.__hb_inj) return args;

        const name = typeof type === 'string' ? type : (type?.displayName || type?.name || type?.default?.displayName || '');
        if (name.includes("Text") || name.includes("Input") || name.includes("Scroll")) return args;

        if (isTargetSheet(props)) {
          const newProps = { ...props, __hb_inj: true };
          const entry = R.createElement(AccountsModalEntry, { key: "hb-account-manager" });
          if (Array.isArray(newProps.children)) newProps.children = newProps.children.concat([entry]);
          else if (newProps.children) newProps.children = [newProps.children, entry];
          else newProps.children = entry;

          if (!sheetLogged) { sheetLogged = true; log("SUCCESS: Injected into " + name); }
          const newArgs = args.slice(); newArgs[1] = newProps; return newArgs;
        }
    } catch(e) { log("inject error: " + e.message); }
    return args;
  };

  safe(() => un.push(hb.patcher.before(R, "createElement", inject)));
  const rt = safe(() => hb.metro.findByProps("jsx", "jsxs"));
  if (rt) { safe(() => un.push(hb.patcher.before(rt, "jsx", inject))); safe(() => un.push(hb.patcher.before(rt, "jsxs", inject))); }
  log("Sheet hook active (Safe Mode).");
}

const undo = [];
return {
  onLoad() {
    if (!vault) return say("Error", "Encryption unavailable.");
    safe(() => { if (store.get("native")) setNative(true); });
    safe(() => registerCommands(undo));
    safe(() => patchAvatar(undo));
    safe(() => patchProfile(undo));
    if (kit) safe(() => patchSheetUI(undo));
  },
  onUnload() {
    undo.splice(0).forEach((f) => safe(f));
    sheetLogged = false; safe(() => nativeUnpatch && nativeUnpatch());
    hbOpenAccounts = () => {};
    secrets.clear();
  },
  settings: kit ? function AccountsSettings() { return R.createElement(AccountsContent, null); } : undefined,
};
