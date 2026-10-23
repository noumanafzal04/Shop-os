import type { NavItem } from "./navItem";
import { adminMainItems, adminPlatformItems } from "./adminMenu";
import { shopMenuInFull } from "./shopNav";

/** Every module on, so a screen the shop has switched off still has its name. */
const EVERY_MODULE = new Proxy({} as Record<string, boolean>, { get: () => true });

const flat = (items: NavItem[]): Array<{ name: string; path: string }> =>
  items.flatMap((i) => [...(i.path ? [{ name: i.name, path: i.path }] : []), ...(i.subItems ?? []).map((s) => ({ name: s.name, path: s.path }))]);

/**
 * WHAT THE MENU CALLS A SCREEN (next rounds #23).
 *
 * A refused screen was named from its address — "Pos is not open to you",
 * "Documents …" for the button called Quotes & Advances. The menu's own name
 * for the path is used instead, in the shop's own trade (a chemist's
 * Dispensary, a station's Forecourt). Null for a path the menu does not hold.
 */
export function screenNameOf(path: string, businessType?: string | null): string | null {
  const bare = path.split(/[?#]/)[0].replace(/\/+$/, "");
  const items = bare.startsWith("/admin")
    ? flat([...adminMainItems, ...adminPlatformItems])
    : flat(shopMenuInFull(EVERY_MODULE, businessType ?? null, true));
  const home = bare === "/admin" || bare === "/tenant";

  const match = items
    .filter((i) => i.path === bare || (!home && i.path !== "/admin" && i.path !== "/tenant" && bare.startsWith(`${i.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];

  return home ? null : (match?.name ?? null);
}
