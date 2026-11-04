// HB Probe: read-only. Collects NAMES and TYPES only. Never reads values of
// token-like properties and never calls getToken or any login function.
const lines = [];
const out = (s) => { lines.push(s); try { hb.logger.log("[probe] " + s); } catch (e) {} };
const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
const describe = (o, max) => {
  if (o === null || o === undefined) return String(o);
  const t = typeof o;
  if (t !== "object" && t !== "function") return t;
  const keys = safe(() => Object.keys(o), []).slice(0, max || 80);
  return t + " {" + keys.map((k) => k + ":" + safe(() => typeof o[k], "?")).join(", ") + "}";
};
const BAD = /token|password|secret/i; // never touch values of these names

function probe() {
  out("hb keys: " + describe(hb, 40));
  for (const k of ["patcher", "metro", "storage", "logger", "flux", "ui"]) {
    out("hb." + k + " = " + describe(hb[k], 60));
  }
  out("hb.ReactNative has Alert: " + safe(() => typeof hb.ReactNative.Alert.prompt, "no"));
  out("hb.ReactNative has Clipboard: " + safe(() => typeof hb.ReactNative.Clipboard, "no"));
  out("hb.ReactNative.NativeModules keys: " + safe(() => Object.keys(hb.ReactNative.NativeModules).join(","), "none"));

  const accessors = ["findByProps", "byProps", "findProps", "find", "findByName", "findAll"];
  out("metro accessors present: " + accessors.filter((a) => safe(() => typeof hb.metro[a] === "function", false)).join(","));

  const find = (names) => {
    for (const a of ["findByProps", "byProps", "findProps"]) {
      if (safe(() => typeof hb.metro[a] === "function", false)) {
        const r = safe(() => hb.metro[a](...names), undefined);
        if (r) return { via: a, mod: r };
      }
    }
    if (safe(() => typeof hb.metro.find === "function", false)) {
      const r = safe(() => hb.metro.find((m) => m && names.every((n) => m[n] !== undefined)), undefined);
      if (r) return { via: "find(pred)", mod: r };
    }
    return null;
  };

  const wanted = [
    ["getToken"], ["loginToken"], ["login", "logout"], ["switchAccount"],
    ["registerCommand"], ["setString"], ["getCurrentUser"], ["getAccounts"],
    ["multiAccountUsers"], ["getMultiAccountUsers"], ["addCommand"], ["pushScreen"], ["showToast"],
  ];
  for (const names of wanted) {
    const r = find(names);
    if (!r) { out("NOT FOUND: " + names.join("+")); continue; }
    // Print key names and types only; skip any key that looks sensitive.
    const keys = safe(() => Object.keys(r.mod), []).filter((k) => !BAD.test(k) || typeof r.mod[k] === "function");
    out("FOUND " + names.join("+") + " via " + r.via + ": " +
      keys.slice(0, 50).map((k) => k + ":" + safe(() => typeof r.mod[k], "?") + (safe(() => typeof r.mod[k] === "function", false) ? "/" + r.mod[k].length : "")).join(", "));
  }
}

return {
  onLoad() {
    try { probe(); } catch (e) { out("probe error: " + (e && e.message)); }
    const text = lines.join("\n");
    safe(() => hb.storage.set && hb.storage.set("probeReport", text));
    safe(() => hb.ReactNative.Alert.alert("HB Probe", "Done (" + lines.length + " lines). Open HeartBlade > Developer > Copy debug report and send it."));
  },
  onUnload() {},
};
