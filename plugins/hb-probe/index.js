// HB Probe v0.3: read-only. Reports property NAMES/kinds only. Never calls
// getToken or any login function and never reads values of any property.
const lines = [];
const out = (s) => { lines.push(s); try { hb.logger.log("[probe] " + s); } catch (e) {} };
const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
const own = (o) => safe(() => Reflect.ownKeys(o).map(String), []);

// How a property is defined, WITHOUT reading its value (no getter is run).
const kind = (o, k) => safe(() => {
  const d = Object.getOwnPropertyDescriptor(o, k);
  if (!d) return "inherited";
  if (d.get || d.set) return "accessor";
  return typeof d.value === "function" ? "fn/" + d.value.length : typeof d.value;
}, "?");

// Lazy stubs (the "$$loader" objects from the last report) answer "function" to
// every property name, so they must be skipped when searching.
const isStub = (m) => safe(() => Object.prototype.hasOwnProperty.call(m, "$$loader") || Object.prototype.hasOwnProperty.call(m, "$$baseObject"), false);

const SEARCHES = {
  auth: /login|logout|switchAccount|multiAccount|addAccount|removeAccount|setToken|authenticate|validateToken/i,
  commands: /^(registerCommand|addCommand|getBuiltInCommands|BUILT_IN_COMMANDS|getCommands|unregisterCommand)$/i,
  nav: /^(pushScreen|showToast|openModal|pushModal)$/i,
};

function search(label, re) {
  const pred = (m) => {
    if (!m || (typeof m !== "object" && typeof m !== "function") || isStub(m)) return false;
    const ks = safe(() => Object.keys(m), []);
    return ks.length > 0 && ks.length < 400 && ks.some((k) => re.test(k));
  };
  const found = safe(() => hb.metro.findAll(pred), []);
  const arr = Array.isArray(found) ? found : [];
  out("search " + label + ": " + arr.length + " module(s)");
  arr.slice(0, 25).forEach((m, i) => {
    const ks = safe(() => Object.keys(m), []);
    const hit = ks.filter((k) => re.test(k)).slice(0, 14);
    out("  [" + label + "#" + i + "] keys=" + ks.length + " match: " + hit.map((k) => k + ":" + kind(m, k)).join(", "));
  });
}

function storeInfo(name) {
  const s = safe(() => hb.metro.findByStoreName(name), undefined);
  if (!s || isStub(s)) { out("store " + name + ": nothing"); return; }
  const proto = safe(() => Object.getPrototypeOf(s), null);
  out("store " + name + " methods: " + (proto ? own(proto).filter((k) => k !== "constructor").map((k) => k + ":" + kind(proto, k)).join(", ") : "none"));
}

function run() {
  ["AuthenticationStore", "MultiAccountStore", "UserStore"].forEach(storeInfo);
  for (const k of Object.keys(SEARCHES)) search(k, SEARCHES[k]);
  out("Alert.prompt: " + safe(() => typeof hb.ReactNative.Alert.prompt, "none"));
  out("Clipboard.setString: " + safe(() => typeof hb.ReactNative.Clipboard.setString, "none"));
}

return {
  onLoad() {
    try { run(); } catch (e) { out("probe error: " + (e && e.message)); }
    safe(() => hb.storage.set("probeReport", lines.join("\n")));
    safe(() => hb.ReactNative.Alert.alert("HB Probe 0.3", "Done (" + lines.length + " lines). Developer > Copy debug report."));
  },
  onUnload() {},
};
