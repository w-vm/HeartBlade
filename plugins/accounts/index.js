// Account Manager (HeartBlade plugin): /token, /login, encrypted account switcher.

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
const GOLD = "#F5D63D"; // Shinobu yellow (chat name color)
const PROFILE_PRIMARY = 0xF5D63D; // profile theme colors (edit to match the gif)
const PROFILE_SECONDARY = 0x8A6A12;
const BOT_BIO = "Kakaka! Made by my master @u6oa";
const BIRTH_MS = Date.UTC(1407, 8, 29); // displays as Sep 20, 1407 (client formats pre-1582 dates in the Julian calendar, 9 days behind)
const BOT_BANNER = "https://images.steamusercontent.com/ugc/991240935447261386/12C1E71B9C0C1415ACBFF4263EA5855568BC62D4/?imw=1200&imh=1200&ima=fit&impolicy=Letterbox&imcolor=%23000000&letterbox=false";
const BOT_AVATAR = "https://raw.githubusercontent.com/w-vm/HeartBlade/main/plugins/accounts/avatar.gif";

const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
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
function saveAccount(token, user) { const tokens = readTokens(); tokens[user.id] = token; writeTokens(tokens); const rest = listAccounts().filter((a) => a.id !== user.id); rest.push({ id: user.id, name: user.name, username: user.username || null, avatar: user.avatar || null }); store.set("accounts", rest); }
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
    return { ok: true, token, user: { id: String(u.id), name: u.global_name || u.username || String(u.id), username: u.username || null, avatar: u.avatar || null } };
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
  return v;
}

async function addByToken() { const t = await ask("Add account", "Paste the account token.", true); if (!t) return false; const v = await validateToken(t); if (!v.ok) { say("Not added", v.reason); return false; } saveAccount(v.token, v.user); say("Account Manager", v.user.name + " added."); return true; }
async function saveCurrent(quiet) { const v = await validateToken(track(currentToken())); if (!v.ok) { if (!quiet) say("Not saved", v.reason); return false; } saveAccount(v.token, v.user); return true; }

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
const COPY_ID = "hb_copy_token";
let copyHooked = false;

function sendLocal(channelId, content, withButton) {
  const maker = findMod((m) => hasFn(m, "createBotMessage"));
  const recv = findMod((m) => hasFn(m, "receiveMessage") && hasFn(m, "sendMessage"));
  if (!maker || !recv) return false;
  const msg = maker.createBotMessage({ channelId, content, embeds: [] });
  msg.colorString = GOLD;
  msg.member = Object.assign({}, msg.member, { colorString: GOLD, nick: BOT_NAME });
  msg.flags = 64; // EPHEMERAL -> "Only you can see this message"
  if (withButton) {
    const button = { type: 2, style: 1, label: "Copy", custom_id: COPY_ID, customId: COPY_ID, disabled: false };
    msg.components = [{ type: 1, components: [button] }];
    msg.application_id = BOT_ID; msg.applicationId = BOT_ID;
  }
  msg.author = Object.assign({}, msg.author, { id: BOT_ID, username: BOT_NAME, globalName: BOT_NAME, global_name: BOT_NAME, avatar: "hb", discriminator: "0", bot: true });
  recv.receiveMessage(channelId, msg);
  return true;
}

// Copy button inside the /token message. Pressing it makes Discord send a component interaction to its REST API;
// that call is caught here (nothing is sent to the server) and the token is copied instead (clipboard cleared after 60s).
function hookCopyButton(un) {
  const isCopy = (a) => safe(() => safeStringify(a).indexOf(COPY_ID) !== -1, false);
  const onCopy = () => { const t = currentToken(); if (t) copyText(t); };
  let hooked = 0;
  // 1) Discord's own handler for a pressed message button: swallow our button before it reaches the server.
  const exec = findMod((m) => hasFn(m, "executeMessageComponentInteraction"));
  if (exec) safe(() => { un.push(hb.patcher.instead(exec, "executeMessageComponentInteraction", (args, orig) => {
    if (!isCopy(args)) return orig(...args);
    onCopy(); return Promise.resolve();
  })); hooked++; });
  // 2) The REST call itself, in case the press reaches it by another route.
  const http = findMod((m) => hasFn(m, "post") && hasFn(m, "getAPIBaseURL"));
  if (http) safe(() => { un.push(hb.patcher.instead(http, "post", (args, orig) => {
    if (!isCopy(args)) return orig(...args);
    onCopy(); return Promise.resolve({ ok: true, status: 204, body: null, headers: {}, text: "" });
  })); hooked++; });
  copyHooked = hooked > 0;
}

// Fallback when the button cannot be hooked: a plain alert with a Copy button.
const offerCopy = (t) => safe(() => RN.Alert.alert("Token", "Tap Copy to copy your token. The clipboard is cleared after 60 seconds.", [
  { text: "Close", style: "cancel" },
  { text: "Copy", onPress: () => { copyText(t); } },
]));

function cmdToken(ctx) {
  const t = track(currentToken());
  const ch = safe(() => ctx.channel.id);
  if (!t) return say("Token", "Could not read token.");
  const text = "||" + t + "||\n" + SHINOBU_LINE;
  const ok = ch && safe(() => sendLocal(ch, text, copyHooked), false);
  if (!ok) { copyText(t); say("Token", "Copied (cleared after 60s)."); return; }
  if (!copyHooked) offerCopy(t);
}

// ---------- bot avatar ----------
const isBotUri = (u) => typeof u === "string" && u.indexOf(BOT_ID) !== -1 && u.indexOf(BOT_AVATAR) === -1 && u.indexOf("steamusercontent") === -1;
const botUriFor = (u) => (String(u).indexOf("/banners/") !== -1 ? BOT_BANNER : BOT_AVATAR);
const fixProps = (p) => { const s = p && fixSource(p.source); if (!s) return null; return Object.assign({}, p, { source: s, resizeMode: "cover", style: [p.style, { resizeMode: "cover" }] }); };
const fixSource = (src) => { if (!src) return null; if (Array.isArray(src)) { const i = src.findIndex((x) => x && isBotUri(x.uri)); if (i < 0) return null; const c = src.slice(); c[i] = Object.assign({}, c[i], { uri: botUriFor(c[i].uri) }); return c; } return isBotUri(src.uri) ? Object.assign({}, src, { uri: botUriFor(src.uri) }) : null; };
function patchImage(un, host, key) { let ok = false; safe(() => { const target = host[key]; if (target && typeof target.render === "function") { un.push(hb.patcher.before(target, "render", (args) => { const np = fixProps(args[0]); if (np) return [np, args[1]]; })); ok = true; } else if (typeof target === "function") { un.push(hb.patcher.before(host, key, (args) => { const np = fixProps(args[0]); if (np) return [np].concat(args.slice(1)); })); ok = true; } }); return ok; }
function patchAvatar(un) { if (!BOT_AVATAR) return; const names = { getUserAvatarURL: "url", getAvatarURL: "url", getUserAvatarSource: "src", getAvatarSource: "src" }; for (const n of Object.keys(names)) { const m = findMod((x) => hasFn(x, n)); if (!m) continue; safe(() => un.push(hb.patcher.after(m, n, (args, ret) => { if (args[0] && args[0].id === BOT_ID) return names[n] === "src" ? { uri: BOT_AVATAR } : BOT_AVATAR; }))); } patchImage(un, RN, "Image"); }

// ---------- bot profile: banner + colors ----------
function patchProfile(un) {
  const st = safe(() => hb.metro.findByStoreName("UserProfileStore"));
  const targets = []; if (st) { targets.push(st); const p = safe(() => Object.getPrototypeOf(st)); if (p && p !== Object.prototype) targets.push(p); }
  for (const t of targets) for (const fn of ["getUserProfile", "getGuildMemberProfile"]) {
    if (typeof t[fn] !== "function") continue;
    safe(() => { un.push(hb.patcher.after(t, fn, (args, ret) => {
      if (args[0] !== BOT_ID) return;
      return Object.assign({}, ret || {}, { userId: BOT_ID, banner: "hb", accentColor: PROFILE_PRIMARY, themeColors: [PROFILE_PRIMARY, PROFILE_SECONDARY], bio: BOT_BIO });
    })); });
  }
  const names = { getUserBannerURL: "url", getBannerURL: "url", getUserBannerSource: "src", getBannerSource: "src" };
  for (const n of Object.keys(names)) {
    const m = findMod((x) => hasFn(x, n)); if (!m) continue;
    safe(() => { un.push(hb.patcher.after(m, n, (args, ret) => {
      const a = args[0];
      if (a && (a.id === BOT_ID || a.userId === BOT_ID)) return names[n] === "src" ? { uri: BOT_BANNER } : BOT_BANNER;
    })); });
  }

  for (const n of ["getMessageAuthor", "useMessageAuthor", "getAuthor"]) {
    const m = findMod((x) => hasFn(x, n)); if (!m) continue;
    safe(() => { un.push(hb.patcher.after(m, n, (args, ret) => {
      const a = ret && (ret.author || ret);
      if (a && (a.id === BOT_ID || (ret.author && ret.author.id === BOT_ID))) return Object.assign({}, ret, { colorString: GOLD, nickname: BOT_NAME });
    })); });
  }
  safe(() => patchBirthDate(un));
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

const mkCmd = (name, description, options, execute) => ({ name, untranslatedName: name, displayName: name, description, untranslatedDescription: description, displayDescription: description, applicationId: "-1", inputType: 1, type: 1, options: options.map((o) => ({ name: o.name, untranslatedName: o.name, displayName: o.name, description: o.description, untranslatedDescription: o.description, displayDescription: o.description, required: !!o.required, type: o.type || 3, autocomplete: false })), execute });
const argOf = (args, name) => safe(() => Array.isArray(args) ? (args.find((x) => x.name === name) || {}).value : args && args[name]);

const commands = [
  mkCmd("accounts", "Open Account Manager", [], () => { if (hbOpenAccounts) hbOpenAccounts(); else say("Account Manager", "Go to HeartBlade Settings to open it."); }),
  mkCmd("token", "Show your token", [], (args, ctx) => { safe(() => cmdToken(ctx)); }),
  mkCmd("login", "Log in with token", [{ name: "token", description: "Token", required: true, type: 3 }], (args) => { (async () => { await saveCurrent(true); const res = await switchTo(argOf(args, "token")); if (res && res !== true) { saveAccount(res.token, res.user); say("Account Manager", "Switched to " + res.user.name + " and saved."); } })().catch((e) => say("Error", scrub(e && e.message))); }),
];

function registerCommands(un) {
  const mod = commandsMod(); if (!mod) return;
  let next = -1000; commands.forEach((c, i) => { c.id = String(next - i); });
  un.push(hb.patcher.after(mod, "getBuiltInCommands", (args, res) => {
    if (!Array.isArray(res)) return;
    const t = args[0];
    const mine = commands.filter((c) => !res.includes(c) && (Array.isArray(t) ? t.includes(c.type) : t === undefined || t === null || c.type === t));
    return mine.length ? res.concat(mine) : undefined;
  }));
}

// ---------- account list UI: the button on the profile page + the sheet ----------

const safeStringify = (obj) => {
  try {
    const seen = new WeakSet();
    return JSON.stringify(obj, (k, v) => {
      if (typeof v === "object" && v !== null) { if (seen.has(v)) return "[Circular]"; seen.add(v); }
      if (typeof v === "function") return "[Function]";
      return v;
    });
  } catch (e) { return ""; }
};

// ---------- "+" : Discord's own login screen ----------
// "+" does what you would do by hand, safely: 1) the current account's token is saved (encrypted), 2) Discord logs out
// locally, but the logout request to the server is held back, so the saved token stays valid, 3) Discord's own official login
// screen opens, 4) the account you log into is saved automatically (watchLogins) and you are already on it.
let pendingOld = null;      // the account we left; checked once the new login is saved, to prove its token survived
async function waitLoggedOut(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (!safe(() => currentToken(), null)) return true; await sleep(40); }
  return !safe(() => currentToken(), null);
}
async function checkOldAccount() {
  const p = pendingOld; if (!p || currentId() === p.id) return;
  pendingOld = null;
  const v = await validateToken(p.token);
  if (!v.ok) say("Add account", "The previous account's saved login no longer works (Discord ended that session). Add it again with /login or its token.");
}

// Discord revokes the session on its server when logout() runs. The old hold only patched the REST module's post(), and the log
// proved it never caught the request ("logout request held back" was never printed, the old token came back invalid every time).
// So now: 1) the request is held at every layer (REST module, fetch, XMLHttpRequest), 2) the local-only logoutInternal() is tried
// FIRST (it clears the session on the device without calling the server), logout() is only the fallback.
function armLogoutHold(onHit) {
  const undo = [];
  const isLogout = (u) => typeof u === "string" && u.indexOf("/auth/logout") !== -1;
  const urlOf = (x) => safe(() => (typeof x === "string" ? x : x && (x.url || x.href || (x.toString && x.toString()))) || "", "");
  const http = findMod((m) => hasFn(m, "post") && hasFn(m, "getAPIBaseURL"));
  if (http) safe(() => undo.push(hb.patcher.instead(http, "post", (args, orig) => {
    if (safe(() => safeStringify(args[0]).indexOf("/auth/logout") !== -1, false)) { onHit("REST post"); return Promise.resolve({ ok: true, status: 204, body: null, headers: {}, text: "" }); }
    return orig(...args);
  })));
  safe(() => { const g = globalThis; if (typeof g.fetch === "function") undo.push(hb.patcher.instead(g, "fetch", (args, orig) => {
    if (isLogout(urlOf(args[0]))) { onHit("fetch"); return Promise.resolve(safe(() => new Response(null, { status: 204 }), { ok: true, status: 204, text: async () => "", json: async () => ({}) })); }
    return orig(...args);
  })); });
  safe(() => { const X = globalThis.XMLHttpRequest; if (!X || !X.prototype) return;
    undo.push(hb.patcher.before(X.prototype, "open", function (args) { this.__hbLogout = isLogout(urlOf(args[1])); }));
    undo.push(hb.patcher.instead(X.prototype, "send", function (args, orig) {
      if (!this.__hbLogout) return orig(...args);
      const x = this; onHit("XMLHttpRequest");
      const def = (k, v) => safe(() => Object.defineProperty(x, k, { value: v, configurable: true, writable: true }));
      def("readyState", 4); def("status", 204); def("statusText", "No Content"); def("responseText", ""); def("response", "");
      setTimeout(() => { for (const h of ["onreadystatechange", "onload", "onloadend"]) safe(() => typeof x[h] === "function" && x[h]({ type: h.slice(2), target: x })); }, 0);
    }));
  });
  return () => undo.forEach((f) => safe(f));
}

async function startAddAccount(onReady) {
  const auth = findMod((m) => hasFn(m, "logout") && hasFn(m, "switchAccountToken"));
  if (!auth) return false;
  if (!(await saveCurrent(true))) { say("Add account", "The current account could not be saved first, so nothing was changed."); return true; }
  if (store.get("native")) setNative(false);                 // the multi-account patch is not needed here
  const oldToken = track(currentToken()), oldId = currentId();
  const release = armLogoutHold(() => {});
  const timer = setTimeout(() => safe(release), 30000);
  const attempt = async (fn) => {
    safe(() => { if (onReady) { const f = onReady; onReady = null; f(); } });
    try { const r = fn(); if (r && typeof r.catch === "function") r.catch(() => {}); }
    catch (e) { return false; }
    return await waitLoggedOut(3500);
  };
  let done = false, local = false;
  if (typeof auth.logoutInternal === "function") { done = await attempt(() => auth.logoutInternal()); local = done; }
  if (!done) done = await attempt(() => auth.logout());
  if (done && local) {
    // logoutInternal() only clears the session; unlike logout() it does not leave the screen, which showed an empty card.
    // Discord's own navigation is used to land on the login screen.
    const nav = findMod((m) => hasFn(m, "resetToAuthRoute"));
    if (nav) { safe(() => nav.resetToAuthRoute()); setTimeout(() => safe(() => { if (!currentToken()) nav.resetToAuthRoute(); }), 350); }
  }
  setTimeout(() => { clearTimeout(timer); safe(release); }, 6000);
  if (!done) return false;
  if (oldToken && oldId) pendingOld = { id: oldId, token: oldToken };
  return true;
}

// ---------- save every account that logs in (via /login, via +, or any other way) ----------
let autoTimer = null;
function autoSave(why) {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => { saveCurrent(true).then((ok) => { if (ok) { checkOldAccount().catch(() => {}); } }).catch(() => {}); }, 1500);
}
function watchLogins(un) {
  // Works without Flux: when the logged-in account id changes (after any login), save it.
  let lastId = currentId();
  const timer = setInterval(() => { const id = safe(() => currentId(), null); if (!id) { lastId = null; return; } if (id !== lastId) { lastId = id; autoSave("account changed"); } }, 3000);
  un.push(() => clearInterval(timer));
  const f = safe(() => hb.flux);
  if (!f || typeof f.subscribe !== "function") return;
  for (const ev of ["CONNECTION_OPEN", "LOGIN_SUCCESS"]) {
    const cb = () => autoSave(ev);
    safe(() => { f.subscribe(ev, cb); un.push(() => f.unsubscribe(ev, cb)); });
  }
}

// ---------- the sheet (look: Discord's "Change Online Status" sheet, compact rows like Instagram's account switcher) ----------
const FALLBACK_COLORS = { sheet: "#232428", card: "#2b2d31", text: "#f2f3f5", muted: "#b5bac1", line: "#3a3c42", blue: "#5865f2", handle: "#4e5058", ring: "#80848e", circle: "#111214", press: "rgba(255,255,255,0.06)", dark: true };
// Colours follow the active HeartBlade theme (kit.sheetColors); plain Discord dark otherwise.
const colors = () => Object.assign({}, FALLBACK_COLORS, safe(() => kit && kit.sheetColors && kit.sheetColors(), null) || {});

function AccountSheet(props) {
  const { View, Text, Image, Pressable, Modal, ScrollView, ActivityIndicator, Animated, PanResponder, Dimensions, Easing } = RN;
  const C = colors();
  const [, force] = R.useState(0); const bump = () => force((n) => n + 1);
  const [busy, setBusy] = R.useState("");
  const cur = currentId();
  const accounts = listAccounts().slice().sort((a, b) => (b.id === cur ? 1 : 0) - (a.id === cur ? 1 : 0));

  // Slide in, and drag the handle / title down to dismiss (or tap outside).
  const H = Dimensions.get("window").height;
  const ty = R.useRef(new Animated.Value(H)).current;
  const closing = R.useRef(false);
  const dismiss = (after) => {
    if (closing.current) return; closing.current = true;
    Animated.timing(ty, { toValue: H, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => { props.onClose(); if (after) after(); });
  };
  const dismissRef = R.useRef(dismiss); dismissRef.current = dismiss;
  R.useEffect(() => { Animated.timing(ty, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, []);
  const pan = R.useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (e, g) => { ty.setValue(Math.max(0, g.dy)); },
    onPanResponderRelease: (e, g) => { if (g.dy > 80 || g.vy > 0.7) dismissRef.current(); else Animated.spring(ty, { toValue: 0, useNativeDriver: true, bounciness: 3 }).start(); },
    onPanResponderTerminate: () => { Animated.spring(ty, { toValue: 0, useNativeDriver: true }).start(); },
  })).current;

  const pick = (a) => {
    if (busy || a.id === cur) return;
    const t = readTokens()[a.id]; if (!t) return say("Missing token", "Add " + a.name + " again.");
    setBusy("Switching to " + a.name + "…");
    switchTo(t).then((r) => { setBusy(""); if (r) props.onClose(); }).catch(() => setBusy(""));
  };
  const remove = (a) => confirmAsk("Remove " + a.name + "?", "It is removed from this list only.", "Remove", true).then((yes) => { if (yes) { removeAccount(a.id); bump(); } });
  const add = async () => {
    if (busy) return;
    setBusy("Preparing…");                                    // the sheet stays up while the account is saved, then closes at the moment of logout
    const ok = await startAddAccount(() => props.onClose());
    if (ok === true) return;
    setBusy("");
    if (!ok) say("Add account", "Discord did not log out, so its login screen could not open. Use \u201cAdd with token\u201d for now.");
  };
  const addToken = () => addByToken().then((ok) => { if (ok) bump(); });

  const AV = 40;
  const row = (key, left, title, sub, right, onPress, onLong, last) =>
    R.createElement(Pressable, { key, onPress, onLongPress: onLong, style: ({ pressed }) => ({ backgroundColor: pressed ? C.press : "transparent" }) },
      R.createElement(View, { style: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, height: 62 } },
        left,
        R.createElement(View, { style: { flex: 1, marginLeft: 12 } },
          R.createElement(Text, { numberOfLines: 1, style: { color: C.text, fontSize: 15, fontWeight: "600" } }, title),
          sub ? R.createElement(Text, { numberOfLines: 1, style: { color: C.muted, fontSize: 12.5, marginTop: 1 } }, sub) : null),
        right),
      last ? null : R.createElement(View, { style: { height: 1, marginLeft: 14 + AV + 12, backgroundColor: C.line } }));

  const radio = (on) => on
    ? R.createElement(View, { style: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.blue, alignItems: "center", justifyContent: "center" } }, R.createElement(View, { style: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" } }))
    : R.createElement(View, { style: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.ring } });

  const rows = accounts.map((a) => row(a.id,
    R.createElement(Image, { source: { uri: avatarUrl(a) }, style: { width: AV, height: AV, borderRadius: AV / 2, backgroundColor: C.line } }),
    a.name, a.username ? "@" + a.username : (a.id === cur ? "Active" : undefined), radio(a.id === cur), () => pick(a), () => remove(a), false));
  rows.push(row("add",
    R.createElement(View, { style: { width: AV, height: AV, borderRadius: AV / 2, backgroundColor: C.circle, alignItems: "center", justifyContent: "center" } }, R.createElement(Text, { style: { color: C.text, fontSize: 24, lineHeight: 27, marginTop: -1 } }, "+")),
    "Add account", undefined, null, add, undefined, true));

  const backdrop = ty.interpolate({ inputRange: [0, H], outputRange: [0.55, 0], extrapolate: "clamp" });
  return R.createElement(Modal, { visible: true, transparent: true, animationType: "none", statusBarTranslucent: true, onRequestClose: () => dismiss() },
    R.createElement(View, { style: { flex: 1, justifyContent: "flex-end" } },
      R.createElement(Animated.View, { style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", opacity: backdrop } },
        R.createElement(Pressable, { onPress: () => dismiss(), style: { flex: 1 } })),
      R.createElement(Animated.View, { style: { transform: [{ translateY: ty }], backgroundColor: C.sheet, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 14, paddingBottom: 30, maxHeight: "85%" } },
        R.createElement(View, Object.assign({ style: { paddingTop: 8, paddingBottom: 4 } }, pan.panHandlers),
          R.createElement(View, { style: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: C.handle, marginBottom: 12 } }),
          R.createElement(Text, { style: { color: C.text, fontSize: 17, fontWeight: "700", textAlign: "center", marginBottom: busy ? 6 : 12 } }, "Account Manager")),
        busy ? R.createElement(View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 10 } }, R.createElement(ActivityIndicator, { color: C.muted }), R.createElement(Text, { style: { color: C.muted, marginLeft: 8, fontSize: 13 } }, busy)) : null,
        R.createElement(ScrollView, { style: { flexGrow: 0, backgroundColor: C.card, borderRadius: 16 }, bounces: false }, ...rows),
        R.createElement(Pressable, { onPress: addToken, style: ({ pressed }) => ({ marginTop: 14, height: 46, borderRadius: 23, borderWidth: 1.5, borderColor: C.handle, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 }) },
          R.createElement(Text, { style: { color: C.text, fontSize: 15, fontWeight: "600" } }, "Add with token")),
        R.createElement(Text, { style: { color: C.muted, fontSize: 12, textAlign: "center", marginTop: 10 } }, "Tap an account to switch. Hold to remove."))));
}

// ---------- the button on the profile page, right under "Note" ----------
function ProfileEntry(props) {
  try {
    const { View, Text, Image, Pressable } = RN;
    const P = colors();
    const [open, setOpen] = R.useState(false);
    R.useEffect(() => { hbOpenAccounts = () => setOpen(true); return () => { hbOpenAccounts = () => {}; }; }, []);
    const cur = listAccounts().find((a) => a.id === currentId());
    // Only on your own profile (the Note card gets the profile's user id); on other people's profiles nothing shows.
    if (!props || !props.userId || String(props.userId) !== String(currentId())) return open ? R.createElement(AccountSheet, { onClose: () => setOpen(false) }) : null;
    return R.createElement(View, { style: { marginTop: 16 } },
      R.createElement(Pressable, { onPress: () => setOpen(true), style: ({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: 64, paddingHorizontal: 16, borderRadius: 16, backgroundColor: pressed ? P.line : P.card }) },
        cur ? R.createElement(Image, { source: { uri: avatarUrl(cur) }, style: { width: 36, height: 36, borderRadius: 18, marginRight: 12 } }) : null,
        R.createElement(View, { style: { flex: 1, paddingVertical: 12 } },
          R.createElement(Text, { style: { color: P.text, fontSize: 16, fontWeight: "600" } }, "Account Manager"),
          R.createElement(Text, { numberOfLines: 1, style: { color: P.muted, fontSize: 13, marginTop: 2 } }, cur ? cur.name : "Switch or add accounts")),
        R.createElement(Text, { style: { color: P.muted, fontSize: 24 } }, "›")),
      open ? R.createElement(AccountSheet, { onClose: () => setOpen(false) }) : null);
  } catch (e) { return null; }
}

// The Note card on a profile page is a component named UserProfileNote (found with the console: dev.tree.find('only visible to you')).
// We wrap that component: whatever it renders, our button is rendered right after it, so it sits directly under the Note card.
// The button only shows on your own profile (props.userId is your id). The module may not be loaded yet when the plugin starts,
// so we also listen for modules that initialise later.
const NOTE_COMPONENT = "UserProfileNote";
const patchedNote = new WeakSet();

function isNoteModule(ex) {
  return !!ex && (typeof ex === "object" || typeof ex === "function") && safe(() => typeof ex.default === "function" && ex.default.name === NOTE_COMPONENT, false);
}

function patchNoteModule(ex, un) {
  if (patchedNote.has(ex)) return true;
  patchedNote.add(ex);
  try {
    un.push(hb.patcher.after(ex, "default", (args, ret) => {
      try {
        const uid = args && args[0] && args[0].userId;
        return R.createElement(R.Fragment, null, ret, R.createElement(ProfileEntry, { key: "hb-account-manager", userId: uid }));
      } catch (e) { return ret; }
    }));
    return true;
  } catch (e) { return false; }
}

function patchProfileEntry(un) {
  const loaded = hb.metro.findAllLoaded || hb.metro.findAll;
  const hits = safe(() => loaded((m) => isNoteModule(m)), []) || [];
  hits.forEach((m) => patchNoteModule(m, un));
  // not loaded yet: patch it the moment its module initialises (before the profile screen can render it)
  if (hb.metro.onModuleInit) un.push(hb.metro.onModuleInit((id, ex) => { safe(() => { if (isNoteModule(ex)) patchNoteModule(ex, un); }); }));
}

const undo = [];
return {
  onLoad() {
    if (!vault) return say("Error", "Encryption unavailable.");
    safe(() => { if (store.get("native")) setNative(true); });
    safe(() => registerCommands(undo));
    safe(() => hookCopyButton(undo));
    safe(() => patchAvatar(undo));
    safe(() => patchProfile(undo));
    safe(() => patchProfileEntry(undo));
    safe(() => watchLogins(undo));
    setTimeout(() => autoSave("load"), 4000);
  },
  onUnload() {
    undo.splice(0).forEach((f) => safe(f));
    clearTimeout(autoTimer); copyHooked = false; safe(() => nativeUnpatch && nativeUnpatch());
    hbOpenAccounts = () => {};
    secrets.clear();
  },
};
