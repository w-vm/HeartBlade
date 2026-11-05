// HB Accounts v0.1.0: token viewer, /login, encrypted multi-account vault.
// Vault: PBKDF2-HMAC-SHA256 + HMAC-CTR + encrypt-then-MAC (pure JS).
// HeartBlade account vault: authenticated encryption in pure JS.
// Scheme: PBKDF2-HMAC-SHA256 -> (encKey, macKey); HMAC-SHA256 in counter mode
// as stream cipher; Encrypt-then-MAC with HMAC-SHA256. Fails closed.
// Output format: "v1." + base64(salt16 | nonce16 | ciphertext | tag32)

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
    const h = new Uint32Array([
      0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19,
    ]);
    const len = data.length;
    const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(data);
    padded[len] = 0x80;
    const bits = len * 8;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(padded.length - 4, bits >>> 0);
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
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]);
    return out;
  }

  function concat(...parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function hmac(key, msg) {
    if (key.length > 64) key = sha256(key);
    const ipad = new Uint8Array(64), opad = new Uint8Array(64);
    ipad.fill(0x36); opad.fill(0x5c);
    for (let i = 0; i < key.length; i++) { ipad[i] ^= key[i]; opad[i] ^= key[i]; }
    return sha256(concat(opad, sha256(concat(ipad, msg))));
  }

  function pbkdf2(password, salt, iterations, dkLen) {
    const blocks = Math.ceil(dkLen / 32);
    const out = new Uint8Array(blocks * 32);
    for (let b = 1; b <= blocks; b++) {
      const idx = new Uint8Array([(b >>> 24) & 255, (b >>> 16) & 255, (b >>> 8) & 255, b & 255]);
      let u = hmac(password, concat(salt, idx));
      const t = u.slice();
      for (let i = 1; i < iterations; i++) {
        u = hmac(password, u);
        for (let j = 0; j < 32; j++) t[j] ^= u[j];
      }
      out.set(t, (b - 1) * 32);
    }
    return out.slice(0, dkLen);
  }

  function utf8Encode(str) {
    const out = [];
    for (const ch of str) {
      let c = ch.codePointAt(0);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
  }

  function utf8Decode(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; ) {
      const b = bytes[i++];
      let c;
      if (b < 0x80) c = b;
      else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[i++] & 63);
      else if (b < 0xf0) { c = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63); }
      else { c = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63); }
      s += String.fromCodePoint(c);
    }
    return s;
  }

  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function b64enc(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
      s += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
      s += i + 2 < bytes.length ? B64[n & 63] : "=";
    }
    return s;
  }
  function b64dec(str) {
    const clean = str.replace(/=+$/, "");
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let o = 0, acc = 0, bits = 0;
    for (const ch of clean) {
      const v = B64.indexOf(ch);
      if (v < 0) throw new Error("vault: bad base64");
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
    }
    return out;
  }

  function randomBytes(n) {
    const c = globalThis.crypto;
    if (!c || typeof c.getRandomValues !== "function") {
      // Fail closed: never fall back to Math.random for key material.
      throw new Error("vault: no secure random source available");
    }
    const out = new Uint8Array(n);
    c.getRandomValues(out);
    return out;
  }

  function ctEqual(a, b) {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }

  function keystream(encKey, nonce, length) {
    const out = new Uint8Array(Math.ceil(length / 32) * 32);
    for (let ctr = 0; ctr * 32 < length; ctr++) {
      const c = new Uint8Array([(ctr >>> 24) & 255, (ctr >>> 16) & 255, (ctr >>> 8) & 255, ctr & 255]);
      out.set(hmac(encKey, concat(nonce, c)), ctr * 32);
    }
    return out.slice(0, length);
  }

  const ITER = 60000;
  const PREFIX = "v1.";

  function deriveKeys(passphrase, salt, iter) {
    const dk = pbkdf2(utf8Encode(passphrase), salt, iter, 64);
    return { encKey: dk.slice(0, 32), macKey: dk.slice(32, 64) };
  }

  function seal(encKey, macKey, salt, plaintext) {
    const nonce = randomBytes(16);
    const pt = utf8Encode(plaintext);
    const ks = keystream(encKey, nonce, pt.length);
    const ct = new Uint8Array(pt.length);
    for (let i = 0; i < pt.length; i++) ct[i] = pt[i] ^ ks[i];
    const tag = hmac(macKey, concat(utf8Encode(PREFIX), salt, nonce, ct));
    return PREFIX + b64enc(concat(salt, nonce, ct, tag));
  }

  function parse(blob) {
    if (typeof blob !== "string" || !blob.startsWith(PREFIX)) throw new Error("vault: unknown format");
    const raw = b64dec(blob.slice(PREFIX.length));
    if (raw.length < 64) throw new Error("vault: truncated");
    return { salt: raw.slice(0, 16), nonce: raw.slice(16, 32), ct: raw.slice(32, raw.length - 32), tag: raw.slice(raw.length - 32) };
  }

  function open(encKey, macKey, p) {
    const expect = hmac(macKey, concat(utf8Encode(PREFIX), p.salt, p.nonce, p.ct));
    if (!ctEqual(expect, p.tag)) throw new Error("vault: wrong passphrase or corrupted data");
    const ks = keystream(encKey, p.nonce, p.ct.length);
    const pt = new Uint8Array(p.ct.length);
    for (let i = 0; i < pt.length; i++) pt[i] = p.ct[i] ^ ks[i];
    return utf8Decode(pt);
  }

  // One key derivation per unlock; fresh random nonce for every save.
  function createSession(passphrase, existingBlob) {
    if (typeof passphrase !== "string" || passphrase.length < 8) {
      throw new Error("vault: passphrase must be at least 8 characters");
    }
    const parsed = existingBlob ? parse(existingBlob) : null;
    const salt = parsed ? parsed.salt : randomBytes(16);
    const { encKey, macKey } = deriveKeys(passphrase, salt, ITER);
    if (parsed) open(encKey, macKey, parsed); // verifies the passphrase, throws if wrong
    return {
      encrypt: (plaintext) => seal(encKey, macKey, salt, plaintext),
      decrypt: (blob) => {
        const p = parse(blob);
        if (!ctEqual(p.salt, salt)) throw new Error("vault: different vault");
        return open(encKey, macKey, p);
      },
      wipe: () => { encKey.fill(0); macKey.fill(0); },
    };
  }

  return { createSession };
})();

// ───────────────────────── HB Accounts ─────────────────────────
// Commands: /token  /login [token]  /accounts
// Rules this plugin follows: tokens are never logged, never written to storage
// unencrypted, and only ever sent to discord.com (to validate them).

const RN = hb.ReactNative;
const API = "https://discord.com/api/v9";
const LOCK_AFTER_MS = 10 * 60 * 1000;
const CLIP_CLEAR_MS = 60 * 1000;

const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
const log = (m) => safe(() => hb.logger.log("[accounts] " + m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get: async (k) => { const v = await Promise.resolve(hb.storage.get(k)); return v === undefined ? null : v; },
  set: async (k, v) => { await Promise.resolve(hb.storage.set(k, v)); },
};

// Any text shown to the user or logged is scrubbed of known secrets first.
const secrets = new Set();
const scrub = (s) => { let t = String(s); for (const x of secrets) if (x && t.includes(x)) t = t.split(x).join("***"); return t; };
const track = (s) => { if (s) secrets.add(s); return s; };

// ── UI helpers (native iOS dialogs only) ──
const say = (title, msg) => safe(() => RN.Alert.alert(title, scrub(msg)));
const ask = (title, msg, secure) => new Promise((resolve) => {
  try {
    RN.Alert.prompt(title, msg, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      { text: "OK", onPress: (v) => resolve(typeof v === "string" ? v.trim() : "") },
    ], secure ? "secure-text" : "plain-text");
  } catch (e) { resolve(null); }
});
const confirm = (title, msg, okLabel, destructive) => new Promise((resolve) => {
  RN.Alert.alert(title, msg, [
    { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
    { text: okLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
  ]);
});
const choose = (title, labels) => new Promise((resolve) => {
  const options = labels.concat(["Cancel"]);
  const cancelButtonIndex = options.length - 1;
  try {
    RN.ActionSheetIOS.showActionSheetWithOptions({ title, options, cancelButtonIndex }, (i) => resolve(i === cancelButtonIndex ? -1 : i));
  } catch (e) { resolve(-1); }
});

// ── Discord internals (looked up lazily; lazy "$$loader" stubs are skipped) ──
const isStub = (m) => safe(() => Object.prototype.hasOwnProperty.call(m, "$$loader") || Object.prototype.hasOwnProperty.call(m, "$$baseObject"), false);
const hasFn = (m, k) => safe(() => typeof Object.getOwnPropertyDescriptor(m, k).value === "function", false);
const findMod = (pred) => safe(() => { const r = hb.metro.findAll((m) => m && !isStub(m) && safe(() => pred(m), false)); return Array.isArray(r) ? r[0] : undefined; }, undefined);
const authStore = () => safe(() => hb.metro.findByStoreName("AuthenticationStore"));
const authActions = () => findMod((m) => hasFn(m, "loginToken") && hasFn(m, "switchAccountToken"));
const commandsMod = () => findMod((m) => hasFn(m, "getBuiltInCommands") && "BUILT_IN_COMMANDS" in m);
const currentToken = () => safe(() => authStore().getToken());
const currentId = () => safe(() => authStore().getId());

// ── Token validation: asks discord.com whether the token works ──
async function validateToken(raw) {
  const token = String(raw || "").trim().replace(/^"|"$/g, "");
  if (!token || /\s/.test(token) || token.length < 20 || token.length > 200) return { ok: false, reason: "That doesn't look like a Discord token." };
  track(token);
  try {
    const r = await fetch(API + "/users/@me", { headers: { Authorization: token } });
    if (r.status === 401) return { ok: false, reason: "Discord rejected this token (invalid or expired)." };
    if (r.status === 429) return { ok: false, reason: "Rate limited by Discord. Try again in a minute." };
    if (!r.ok) return { ok: false, reason: "Could not verify token (HTTP " + r.status + ")." };
    const u = await r.json();
    if (!u || !u.id) return { ok: false, reason: "Unexpected reply from Discord." };
    return { ok: true, token, user: { id: String(u.id), label: u.global_name || u.username || String(u.id) } };
  } catch (e) {
    return { ok: false, reason: "Network error while verifying the token." };
  }
}

// ── Email + password login (best effort; Discord may demand a captcha) ──
async function passwordLogin(email, password) {
  const post = async (path, body) => {
    const r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.json().catch(() => ({}));
  };
  let j = await post("/auth/login", { login: email, password, undelete: false, login_source: null, gift_code_sku_id: null });
  if (j && j.mfa && j.ticket) {
    const code = await ask("Two-factor code", "Enter your authenticator code.", false);
    if (!code) return { ok: false, reason: "Cancelled." };
    j = await post("/auth/mfa/totp", { code, ticket: j.ticket, login_source: null, gift_code_sku_id: null });
  }
  if (j && j.token) return { ok: true, token: track(j.token) };
  if (j && j.captcha_key) return { ok: false, reason: "Discord asked for a captcha. Use the token method instead." };
  return { ok: false, reason: (j && j.message) || "Login failed." };
}

// ── Vault (encrypted storage) ──
let session = null;     // Vault session, only while unlocked
let data = null;        // { accounts: [{id,label,token,addedAt}] }
let lockTimer = null;
const touch = () => { clearTimeout(lockTimer); lockTimer = setTimeout(lock, LOCK_AFTER_MS); };
function lock() { clearTimeout(lockTimer); safe(() => session && session.wipe()); session = null; data = null; log("vault locked"); }

async function unlock() {
  if (session && data) { touch(); return true; }
  const blob = await store.get("vault");
  let pass = await ask(blob ? "Unlock accounts" : "Create account vault",
    blob ? "Enter your vault passphrase." : "Choose a passphrase (8+ characters). It cannot be recovered if you forget it.", true);
  if (!pass) return false;
  try {
    if (!blob) {
      const again = await ask("Confirm passphrase", "Type it again.", true);
      if (again !== pass) { say("Vault", "Passphrases did not match."); return false; }
    }
    track(pass);
    session = Vault.createSession(pass, blob);
    data = blob ? JSON.parse(session.decrypt(blob)) : { accounts: [] };
    if (!blob) await persist();
    touch();
    return true;
  } catch (e) {
    session = null; data = null;
    say("Vault", /wrong passphrase/.test(String(e.message)) ? "Wrong passphrase." : "Could not open the vault: " + scrub(e.message));
    return false;
  } finally { pass = null; }
}

async function persist() { await store.set("vault", session.encrypt(JSON.stringify(data))); }

async function saveAccount(token, user) {
  if (!(await unlock())) return false;
  const i = data.accounts.findIndex((a) => a.id === user.id);
  const rec = { id: user.id, label: user.label, token, addedAt: Date.now() };
  if (i >= 0) data.accounts[i] = rec; else data.accounts.push(rec);
  await persist();
  return true;
}

// ── Actions ──
async function copySecret(text) {
  RN.Clipboard.setString(text);
  setTimeout(async () => { // clear the clipboard later, but only if it still holds our secret
    try { const now = await RN.Clipboard.getString(); if (now === text) RN.Clipboard.setString(""); } catch (e) {}
  }, CLIP_CLEAR_MS);
}

async function cmdToken() {
  const t = track(currentToken());
  if (!t) return say("Token", "Could not read the current token.");
  const preview = t.slice(0, 6) + "…(" + t.length + " chars)";
  RN.Alert.alert("Your token", preview + "\n\nAnyone with this token controls your account. Never share it. The clipboard is cleared after 60 seconds.", [
    { text: "Cancel", style: "cancel" },
    { text: "Copy", onPress: () => copySecret(t) },
  ]);
}

async function switchTo(token) {
  const v = await validateToken(token);
  if (!v.ok) { say("Cannot switch", v.reason); return false; }
  const act = authActions();
  if (!act) { say("Cannot switch", "Discord's login module was not found in this build."); return false; }
  const mode = (await store.get("mode")) === "switchAccountToken" ? "switchAccountToken" : "loginToken";
  if (currentId() === v.user.id) { say("Accounts", v.user.label + " is already the active account."); return true; }
  try { await Promise.resolve(act[mode](v.token)); }
  catch (e) { say("Switch failed", "Discord reported an error: " + scrub(e && e.message)); return false; }
  await sleep(2500);
  if (currentId() !== v.user.id) {
    say("Switch unclear", "Discord did not switch to " + v.user.label + ". Open /accounts and try the other switch method.");
    return false;
  }
  log("switched account via " + mode);
  return v;
}

async function cmdLogin(tokenArg) {
  let token = tokenArg;
  if (!token) token = await ask("Login with token", "Paste the token of the account to log into.", true);
  if (!token) return;
  const res = await switchTo(token);
  if (!res || res === true) return;
  if (await saveAccount(res.token, res.user)) say("Accounts", "Switched to " + res.user.label + " and saved it to the vault.");
  else say("Accounts", "Switched to " + res.user.label + ". Not saved (vault stayed locked).");
}

async function addByToken() {
  const t = await ask("Add account", "Paste the account token.", true);
  if (!t) return;
  const v = await validateToken(t);
  if (!v.ok) return say("Not added", v.reason);
  if (await saveAccount(v.token, v.user)) say("Accounts", v.user.label + " was added.");
}

async function addByPassword() {
  const email = await ask("Add account", "Email or phone", false);
  if (!email) return;
  const pw = await ask("Add account", "Password (never stored; only the resulting token is, encrypted).", true);
  if (!pw) return;
  const r = await passwordLogin(email, track(pw));
  if (!r.ok) return say("Not added", r.reason);
  const v = await validateToken(r.token);
  if (!v.ok) return say("Not added", v.reason);
  if (await saveAccount(v.token, v.user)) say("Accounts", v.user.label + " was added.");
}

async function cmdAccounts() {
  if (!(await unlock())) return;
  const cur = currentId();
  const mode = (await store.get("mode")) === "switchAccountToken" ? "switchAccountToken" : "loginToken";
  const names = data.accounts.map((a) => a.label + (a.id === cur ? "  ✓" : ""));
  const extra = ["+ Add by token", "+ Add by email & password", "Save current account", "Remove an account", "Switch method: " + mode, "Lock vault"];
  const i = await choose("Accounts", names.concat(extra));
  if (i < 0) return;
  if (i < names.length) {
    const a = data.accounts[i];
    return void (await switchTo(a.token));
  }
  switch (i - names.length) {
    case 0: return addByToken();
    case 1: return addByPassword();
    case 2: {
      const t = track(currentToken()); const v = await validateToken(t);
      if (!v.ok) return say("Not saved", v.reason);
      if (await saveAccount(v.token, v.user)) say("Accounts", v.user.label + " saved.");
      return;
    }
    case 3: {
      if (!data.accounts.length) return say("Accounts", "Nothing to remove.");
      const j = await choose("Remove which account?", data.accounts.map((a) => a.label));
      if (j < 0) return;
      const a = data.accounts[j];
      if (await confirm("Remove " + a.label + "?", "The saved token is deleted from the vault. The account itself is not affected.", "Remove", true)) {
        data.accounts.splice(j, 1); await persist(); say("Accounts", a.label + " removed.");
      }
      return;
    }
    case 4: await store.set("mode", mode === "loginToken" ? "switchAccountToken" : "loginToken"); return say("Accounts", "Switch method is now " + (mode === "loginToken" ? "switchAccountToken" : "loginToken") + ".");
    case 5: lock(); return say("Vault", "Locked.");
  }
}

// ── Command registration (own patch, restored on unload) ──
const guard = (fn) => (...a) => { fn(...a).catch((e) => say("Accounts", "Unexpected error: " + scrub(e && e.message))); };
const argOf = (args, name) => safe(() => Array.isArray(args) ? (args.find((x) => x.name === name) || {}).value : args && args[name]);
const mkCmd = (name, description, options, execute) => ({
  id: "hb-accounts-" + name, name, displayName: name, description, displayDescription: description,
  applicationId: "-1", inputType: 1, type: 1,
  options: options.map((o) => ({ name: o.name, displayName: o.name, description: o.description, displayDescription: o.description, required: !!o.required, type: 3 })),
  execute,
});
const commands = [
  mkCmd("token", "Show or copy the token of the current account", [], guard(() => cmdToken())),
  mkCmd("login", "Log into another account (leave token empty to enter it securely)", [{ name: "token", description: "Account token (safer: leave empty)" }],
    guard((args) => cmdLogin(argOf(args, "token")))),
  mkCmd("accounts", "Switch, add or remove saved accounts", [], guard(() => cmdAccounts())),
];

let restore = null;
function registerCommands() {
  const mod = commandsMod();
  if (!mod) { log("commands module not found"); return false; }
  const orig = mod.getBuiltInCommands;
  const wrapped = function (...a) {
    const r = orig.apply(this, a);
    return Array.isArray(r) ? r.concat(commands) : r;
  };
  try { mod.getBuiltInCommands = wrapped; }
  catch (e) { try { Object.defineProperty(mod, "getBuiltInCommands", { value: wrapped, configurable: true, writable: true }); } catch (e2) { log("cannot patch getBuiltInCommands"); return false; } }
  const list = mod.BUILT_IN_COMMANDS;
  const added = Array.isArray(list) ? commands.filter((c) => !list.includes(c)) : [];
  added.forEach((c) => list.push(c));
  restore = () => {
    safe(() => { mod.getBuiltInCommands = orig; });
    added.forEach((c) => safe(() => list.splice(list.indexOf(c), 1)));
  };
  log("commands registered: " + commands.map((c) => "/" + c.name).join(", "));
  return true;
}

return {
  onLoad() {
    try { if (!registerCommands()) log("commands NOT registered"); } catch (e) { log("register error: " + scrub(e && e.message)); }
  },
  onUnload() {
    safe(() => restore && restore());
    lock();
    secrets.clear();
  },
};
