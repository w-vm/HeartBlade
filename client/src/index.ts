import { installMetroHook, findLoaded, byProps, onModuleInit } from "./metro";
import { startEnabledPlugins } from "./plugins";
import { startEnabledTheme } from "./themes";
import * as native from "./native";
import { installSettingsEntry, settingsDone, settingsStats } from "./settings";
import { runningPlugins } from "./plugins";
import { moduleCount } from "./metro";
import { log, error } from "./log";

// Must happen synchronously, before Discord's own bundle registers its modules.
installMetroHook();

(globalThis as any).__hb = { version: __HB_VERSION__, native: native.hasNative() };
log(`runtime ${__HB_VERSION__} (native ${native.version()})`);

let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  try { startEnabledTheme(); } catch (e) { error("theme boot", e); }
  try { startEnabledPlugins(); } catch (e) { error("plugin boot", e); }
  let settings: any = null;
  try { settings = installSettingsEntry(); } catch (e) { error("settings boot", e); }
  let last: any = settings;
  const publish = (st: any) => { last = st; native.setInfo(JSON.stringify({ client: __HB_VERSION__, modules: moduleCount(), plugins: runningPlugins(), settings: { ...st, live: settingsStats() } })); };
  publish(settings);
  log("ready");
  // Discord fills its settings modules lazily, so keep trying; afterwards keep the live counters fresh for a while
  // (they change when the settings screen is opened).
  if (typeof setTimeout === "function") {
    let tries = 0;
    const tick = () => {
      tries++;
      if (!settingsDone()) { try { publish(installSettingsEntry()); } catch (e) { error("settings retry", e); } }
      else publish(last);
      if (tries < (settingsDone() ? 400 : 120) + 0) setTimeout(tick, settingsDone() ? 3000 : tries < 30 ? 2000 : 5000);
    };
    setTimeout(tick, 2000);
  }
}

function discordReady(): boolean {
  try { return !!findLoaded(byProps("dispatch", "subscribe", "unsubscribe")); } catch { return false; }
}

// Timers don't exist yet when we are injected (React Native installs them later),
// so until setTimeout appears we piggy-back on Discord's module initialisation.
function poll(attempt = 0) {
  if (booted) return;
  if (discordReady()) return boot();
  if (attempt > 300) return error("gave up waiting for Discord modules");
  setTimeout(() => poll(attempt + 1), 100);
}

if (typeof setTimeout === "function") poll();
else {
  const off = onModuleInit(() => {
    if (typeof setTimeout === "function") { off(); poll(); }
  });
}
