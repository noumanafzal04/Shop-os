import { applyTenantTheme, type TenantThemeOptions } from "./tenantTheme";

/**
 * THE SHOP'S COLOURS, KEPT ON THE DEVICE.
 *
 *     "jb page refresh hota hai to pehle theme ka color show krta, phr wo
 *      krta jo save kia hota. Ye cache hojana chahye jb tk change na kry us
 *      device py."
 *
 * ── What happened on every reload ────────────────────────────────────
 *
 * The shop's colours live in its settings, and its settings are a request.
 * Until that request came back the page was painted in the house blue; then
 * it changed to the shop's own. On a counter machine that is every morning,
 * and on a slow line it is a second or two of somebody else's shop.
 *
 * Dark mode had the same flash from a different cause: the provider started
 * every session as "light" and switched in an effect, one paint later.
 *
 * ── What happens now ─────────────────────────────────────────────────
 *
 * The last colours this device was told are kept beside the sign-in, and put
 * back on the page BEFORE the first paint (`bootTheme`, called from main.tsx
 * above `render`). The settings request still runs; when it answers the same
 * thing, nothing moves. When it answers something new — the owner changed
 * the colours on another machine — the page changes once, and remembers.
 *
 * ── Whose colours ────────────────────────────────────────────────────
 *
 * Kept WITH the shop's id, and only ever put back for that shop's own
 * sign-in. A device used by two shops, or by a shop and then by the platform
 * console, must not open one in the other's colours.
 */

/** New key. The existing ones are never renamed — see storageKeys.test.ts. */
const KEY = "shopos-theme";
const AUTH_KEY = "shopos-auth";
/** ThemeContext's own key, read here so dark mode is on the page before React is. */
const MODE_KEY = "theme";

interface Remembered extends TenantThemeOptions {
  tenant: string;
}

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Private windows and blocked site data throw on the accessor itself.
    return null;
  }
};

export function rememberTenantTheme(tenantId: string | null | undefined, options: TenantThemeOptions): void {
  if (!tenantId) return;
  try {
    storage()?.setItem(KEY, JSON.stringify({ tenant: tenantId, ...options } satisfies Remembered));
  } catch {
    // Full or blocked: the page still gets its colours from the request.
  }
}

/** The colours this device last saw for THIS shop, or null. */
export function recallTenantTheme(tenantId: string | null | undefined): TenantThemeOptions | null {
  if (!tenantId) return null;
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const { tenant, ...options } = JSON.parse(raw) as Remembered;

    return tenant === tenantId ? options : null;
  } catch {
    return null;
  }
}

/** Who is signed in on this device, read straight from the persisted session. */
/**
 * The name the PLATFORM CONSOLE's look is remembered under.
 *
 * Not a tenant id and never mistakable for one — a shop's id is a UUID. One
 * laptop is very often signed in to the console in the morning and to a shop
 * in the afternoon, and each must find its own look and never the other's.
 */
export const PLATFORM_LOOK = "platform";

/** Whose look this device should open in: a shop's id, the platform's name, or nobody's. */
function whoseLook(): string | null {
  try {
    const raw = storage()?.getItem(AUTH_KEY);
    if (!raw) return null;
    const user = (JSON.parse(raw) as { state?: { user?: { role?: string; tenant?: { id?: string } | null } | null } })
      .state?.user;
    // The console has a look of its own now, and its people wear it.
    if (user?.role === "super_admin" || user?.role === "admin_staff") return PLATFORM_LOOK;
    // Only a shop's own people wear a shop's colours. A customer keeps the
    // house look.
    if (user?.role !== "shop_owner" && user?.role !== "staff") return null;

    return user.tenant?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Put the remembered look on the page. Called ONCE, before React renders.
 *
 * Returns what it applied, for the test and for nobody else.
 */
export function bootTheme(): { dark: boolean; shop: TenantThemeOptions | null } {
  let dark = false;
  try {
    dark = storage()?.getItem(MODE_KEY) === "dark";
  } catch {
    dark = false;
  }
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", dark);
  }

  const shop = recallTenantTheme(whoseLook());
  if (shop) applyTenantTheme(shop);

  return { dark, shop };
}
