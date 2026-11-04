import * as native from "./native";

// Small JS-side preferences (prefs.json). Native-side switches (Load client, dev URL, shake) live in NSUserDefaults.
export interface Prefs { safeMode?: boolean; }
const FILE = "prefs.json";
export const readPrefs = () => native.readJSON<Prefs>(FILE, {});
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  const p = readPrefs();
  p[key] = value;
  native.writeJSON(FILE, p);
}
