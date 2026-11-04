import * as metro from "../metro";
import { BRAND } from "../brand";
import { openUrl } from "./kit";

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

/** Opens the profile sheet inside Discord; falls back to the https link only if the in-app opener is missing. */
export function openProfile(id: string = BRAND.discordId) {
  try {
    const m = profileOpener();
    if (typeof m?.showUserProfile === "function") { m.showUserProfile({ userId: id }); return; }
  } catch { /* fall through */ }
  openUrl(BRAND.discordUrl);
}
