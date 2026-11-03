import { nativeLog } from "./native";

const PREFIX = "[HeartBlade]";
const fmt = (a: any[]) => a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack ?? ""}` : typeof x === "string" ? x : safe(x))).join(" ");
const safe = (x: any) => { try { return JSON.stringify(x); } catch { return String(x); } };
const out = (level: "log" | "warn" | "error", a: any[]) => {
  console[level](PREFIX, ...a);
  nativeLog(`${level.toUpperCase()} ${fmt(a)}`); // shown in the panel's log viewer
};

export const log = (...a: any[]) => out("log", a);
export const warn = (...a: any[]) => out("warn", a);
export const error = (...a: any[]) => out("error", a);
