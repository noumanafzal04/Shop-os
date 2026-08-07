import { useAuthStore } from "../../stores/authStore";
import type { User } from "../../modules/auth/types";

/**
 * What this app is, for this user, right now.
 *
 * Everything the Business App shows is computed here from three axes the
 * backend already hands us in a single `/auth/me`:
 *
 *   MODULE      tenant.features        — what the shop was granted
 *   TRADE       business_type_primary  — what kind of shop it is
 *   PERSON      user.permissions       — what this person may do
 *
 * Ported from the web panel's `capabilities.ts` deliberately: the same three
 * axes, computed the same way, so a screen that appears on the panel and a
 * screen that appears on the phone can never disagree about who may see it.
 *
 * TWO RULES THAT MUST NOT BE BROKEN:
 *
 *   1. Never branch on a role name. `UserRole` has five cases and none of them
 *      is "cashier", "waiter" or "kitchen" — those are permission SETS on a
 *      staff user. `if (role === "waiter")` will compile and always be false.
 *
 *   2. Hiding a screen is courtesy, not security. The backend re-checks tenant,
 *      module and permission on every request, and it is the only authority. We
 *      hide things so the app is not full of dead ends, never to protect data.
 */

export interface Capabilities {
  // ── Raw axes ────────────────────────────────────────────────
  /** The resolved trade — `business_type_primary`, never the raw code. */
  trade: string | null;
  modules: Record<string, boolean>;

  hasModule: (module: string) => boolean;
  /** ANY of the listed modules, matching the backend's `feature:a,b` gate. */
  hasAnyModule: (...modules: string[]) => boolean;
  can: (permission: string) => boolean;
  isTrade: (...trades: string[]) => boolean;

  // ── Derived shape ───────────────────────────────────────────
  /** Does this shop sell anything at all? False = a books-only tenant. */
  sells: boolean;
  /** Books-only: Expense Manager and nothing else. The app becomes finance. */
  booksOnly: boolean;
  pos: boolean;
  online: boolean;
  restaurant: boolean;
  inventory: boolean;
  expenses: boolean;
  delivery: boolean;

  /** The one gate every screen goes through. */
  showScreen: (spec: ScreenSpec) => boolean;
}

/**
 * What a screen needs in order to be reachable. Absent fields mean "no
 * requirement", so a screen with an empty spec is always shown.
 */
export interface ScreenSpec {
  /** Any one of these modules. */
  modules?: string[];
  /** All of these permissions. */
  permissions?: string[];
  /** Only these trades. Empty = every trade. */
  trades?: string[];
}

/**
 * The computation itself, as a pure function of the signed-in user.
 *
 * Kept free of React so it can be reasoned about and tested directly — this is
 * the most consequential logic in the app and it should not need a renderer to
 * prove.
 */
export function capabilitiesFor(user: User | null): Capabilities {
  const tenant = user?.tenant ?? null;

  const modules = tenant?.features ?? {};
  const permissions = user?.permissions ?? [];
  const role = user?.role;

  // The shop owner holds every permission, exactly as the backend treats them.
  // Mirrors authStore.hasPermission so the two can't drift.
  const can = (permission: string) => role === "shop_owner" || permissions.includes(permission);

  const hasModule = (module: string) => modules[module] === true;
  const hasAnyModule = (...list: string[]) => list.some(hasModule);

  // Fall back to the raw code: a session persisted before `business_type_primary`
  // existed must not lose every trade screen while waiting for a refresh.
  const trade = tenant?.business_type_primary ?? tenant?.business_type ?? null;
  const isTrade = (...list: string[]) => (trade === null ? false : list.includes(trade));

  const pos = hasModule("pos");
  const online = hasModule("marketplace") || hasModule("delivery");
  const products = hasModule("products");
  const services = hasModule("services");
  const restaurant = hasModule("dine_in");
  const expenses = hasModule("expenses");

  const sells = pos || products || services || restaurant || hasModule("marketplace");

  return {
    trade,
    modules,
    hasModule,
    hasAnyModule,
    can,
    isTrade,

    sells,
    // A tenant granted expenses and no way to sell anything is a bookkeeping
    // office. The app should stop calling it a shop and drop every selling
    // screen rather than showing empty ones.
    booksOnly: expenses && !sells,
    pos,
    online,
    restaurant,
    inventory: hasModule("inventory"),
    expenses,
    delivery: hasModule("delivery"),

    showScreen: ({ modules: need, permissions: needPerms, trades }: ScreenSpec) => {
      if (need?.length && !need.some(hasModule)) return false;
      if (needPerms?.length && !needPerms.every(can)) return false;
      if (trades?.length && !isTrade(...trades)) return false;
      return true;
    },
  };
}

/** The hook the app uses. All of the thinking is in `capabilitiesFor`. */
export function useCapabilities(): Capabilities {
  return capabilitiesFor(useAuthStore((s) => s.user));
}
