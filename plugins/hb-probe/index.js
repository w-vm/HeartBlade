// HB Probe v0.2: read-only. Reports NAMES/TYPES only. Never calls getToken or
// any login function and never reads values of token-like properties.
const lines = [];
const out = (s) => { lines.push(s); try { hb.logger.log("[probe] " + s); } catch (e) {} };
const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
const own = (o) => safe(() => Reflect.ownKeys(o).map(String), []);
const typeOf = (o, k) => safe(() => typeof o[k], "throws");

function inspect(label, mod, names) {
  if (mod === undefined || mod === null) { out(label + ": nothing"); return; }
  const keys = own(mod);
  const proto = safe(() => own(Object.getPrototypeOf(mod)), []);
  out(label + ": typeof=" + typeof mod + " ownKeys=" + keys.length + " protoKeys=" + proto.length +
    " names=" + names.map((n) => n + ":" + typeOf(mod, n)).join(","));
  if (keys.length) out(label + " keys: " + keys.slice(0, 60).join(","));
}

function run() {
  // 1) Negative control: a name that cannot exist. If this "finds" something,
  //    findByProps returns a stub and its results are meaningless.
  const ctl = safe(() => hb.metro.findByProps("zzNotARealProp9371"), "threw");
  out("control findByProps(nonexistent) => " + (ctl === undefined ? "undefined" : ctl === null ? "null" : ctl === "threw" ? "threw" : typeof ctl + " ownKeys=" + own(ctl).length));
  const ctl2 = safe(() => hb.metro.find((m) => m && m.zzNotARealProp9371 !== undefined), "threw");
  out("control find(pred nonexistent) => " + (ctl2 === undefined ? "undefined" : ctl2 === null ? "null" : ctl2 === "threw" ? "threw" : typeof ctl2));

  // 2) Predicate search with strict typeof checks (real modules only).
  const wanted = [
    ["getToken"], ["loginToken"], ["login"], ["logout"], ["switchAccount"], ["registerCommand"],
    ["getCurrentUser"], ["showToast"], ["pushScreen"], ["getMultiAccountUsers"], ["multiAccountUsers"], ["getAccounts"],
  ];
  for (const names of wanted) {
    const m = safe(() => hb.metro.find((x) => x && names.every((n) => typeof x[n] === "function")), undefined);
    inspect("find fn " + names.join("+"), m, names);
  }

  // 3) Store lookups (Discord stores are looked up by name).
  for (const s of ["AuthenticationStore", "UserStore", "MultiAccountStore", "AccountStore", "SessionsStore"]) {
    const m = safe(() => hb.metro.findByStoreName(s), undefined);
    inspect("store " + s, m, ["getToken", "getCurrentUser", "getUsers", "getAccounts"]);
  }

  // 4) Clipboard + prompt availability.
  const cb = safe(() => hb.ReactNative.Clipboard, undefined);
  inspect("RN.Clipboard", cb, ["setString", "setStringAsync", "getString"]);
  out("Alert.prompt: " + typeOf(safe(() => hb.ReactNative.Alert, {}), "prompt"));
  out("RN keys: " + own(hb.ReactNative).slice(0, 80).join(","));

  // 5) Command-related modules by name.
  for (const n of ["CommandsStore", "ApplicationCommandStore", "ChatInputCommands"]) {
    inspect("name " + n, safe(() => hb.metro.findByName(n), undefined), ["registerCommand", "getCommands"]);
  }
}

return {
  onLoad() {
    try { run(); } catch (e) { out("probe error: " + (e && e.message)); }
    safe(() => hb.storage.set("probeReport", lines.join("\n")));
    safe(() => hb.ReactNative.Alert.alert("HB Probe 0.2", "Done (" + lines.length + " lines). Developer > Copy debug report."));
  },
  onUnload() {},
};
