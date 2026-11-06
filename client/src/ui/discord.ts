import * as metro from "../metro";
import { BRAND } from "../brand";
import { openUrl } from "./kit";
import { log } from "../log";

// Looks up the author's Discord account inside the running app (name + avatar) and opens the profile in-app.

export interface DUser { username: string; avatar: string | null; }

const userStore = metro.lazy<any>(() => metro.findByStoreName("UserStore"));
const userActions = metro.lazy<any>(() => metro.findByProps("fetchProfile"));
const profileOpener = metro.lazy<any>(() => metro.findByProps("showUserProfile"));

function avatarOf(u: any): string | null {
  try {
    const f = u.getAvatarURL?.(undefined, 128, false);
    if (typeof f === "string" && f) return f.startsWith("//") ? "https:" + f : f;
  } catch { /* fall through */ }
  try {
    if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${String(u.avatar).startsWith("a_") ? "gif" : "png"}?size=128`;
    return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> BigInt(22)) % BigInt(6))}.png`;
  } catch { return null; }
}

export function cachedUser(id: string): DUser | null {
  try {
    const u = userStore()?.getUser?.(id);
    return u?.username ? { username: String(u.username), avatar: avatarOf(u) } : null;
  } catch { return null; }
}

/** Uses the cache first; otherwise asks Discord to fetch the account, then reads it back from the store. */
export async function loadUser(id: string): Promise<DUser | null> {
  const hit = cachedUser(id); if (hit) return hit;
  const ua = userActions();
  for (const call of [() => ua?.getUser?.(id), () => ua?.fetchProfile?.(id)]) {
    try { await call(); } catch { /* try the next one */ }
    const u = cachedUser(id); if (u) return u;
  }
  return null;
}

const OPENERS = ["showUserProfileActionSheet", "showUserProfile", "openUserProfile", "openUserProfileSheet", "showUserProfileSheet", "openUserProfileModal"];

/** The function that opens a profile: an export with that name, or a module whose (default) function is named like it. */
function findOpener(name: string): ((a: any) => any) | null {
  try {
    const m = metro.findByProps(name);
    if (typeof m?.[name] === "function") return (a) => m[name](a);
  } catch { /* next lookup */ }
  try {
    const m = metro.find((x: any) => { try { return typeof x?.default === "function" && (x.default.name === name || x.default.displayName === name); } catch { return false; } });
    if (m) return (a) => m.default(a);
  } catch { /* none */ }
  try {
    const f = metro.find((x: any) => { try { return typeof x === "function" && (x.name === name || x.displayName === name); } catch { return false; } });
    if (typeof f === "function") return (a) => f(a);
  } catch { /* none */ }
  return null;
}

/**
 * Opens the profile inside Discord, never in the browser. Order: Discord's own profile opener (several known names,
 * a failing one is skipped), then Discord's own app link (discord://, handled by the app itself), and only as the very
 * last resort the https link.
 */
export function openProfile(id: string = BRAND.discordId) {
  for (const name of OPENERS) {
    const fn = findOpener(name);
    if (!fn) continue;
    for (const args of [{ userId: id }, { userId: id, analyticsLocation: { page: "HeartBlade" } }]) {
      try { fn(args); log(`profile opened in-app via ${name}`); return; } catch (e) { log(`profile opener ${name} failed: ${(e as any)?.message ?? e}`); }
    }
  }
  openUrl(`discord://-/users/${id}`, () => openUrl(BRAND.discordUrl));
  log("profile opened via discord:// link");
}
