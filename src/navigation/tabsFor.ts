import type { SessionUser } from "../types/session";

export type PartnerTab = "Dashboard" | "Orders" | "Menu" | "Money" | "Account";

/**
 * WHICH TABS THIS PERSON GETS, decided in ONE place.
 *
 * `GET /auth/me` returns `permissions[]` and `tenant.features`. A tab the
 * signed-in user cannot use is never rendered — not greyed out, not shown and
 * then refused on open.
 *
 * ── Why one file and not a check per screen ──────────────────────────
 *
 * This codebase has the scar. Four separate guards once read one route list,
 * so adding a screen meant remembering six places; and a kitchen preset was
 * offered a board by four surfaces and bounced by the fifth. One map, read by
 * the tab bar AND by the navigator, or the two disagree and a tab leads
 * nowhere.
 *
 * ── The permission names are checked, not remembered ─────────────────
 *
 * The plan for this file said Money needed `reports.read`. The permission is
 * `reports.view`; `reports.read` does not exist and never has. Written from
 * memory it would have hidden the Money tab from everybody, for ever, with no
 * error anywhere — a tab that is simply absent looks like a product decision.
 * Every string below was read out of `app/Support/Permissions.php`.
 */
interface TabRule {
  tab: PartnerTab;
  /** Absent = everybody. */
  permission?: string;
  /** Absent = no module gate. Read from `tenant.features`. */
  module?: string;
  /** Extra condition on the shop itself. */
  shop?: (user: SessionUser) => boolean;
}

/**
 * Order matters — this is the order they appear in the bar, and Dashboard is
 * first because it is where somebody lands.
 */
const RULES: TabRule[] = [
  { tab: "Dashboard" },
  {
    tab: "Orders",
    permission: "orders.manage",
    // A walk-in-only shop has no online orders to show. The tab would open on
    // an empty list that can never fill, which reads as a broken screen rather
    // than as a module that is off.
    shop: (u) => u.tenant?.online_shop_enabled === true,
  },
  { tab: "Menu", permission: "products.manage", module: "products" },
  { tab: "Money", permission: "reports.view" },
  { tab: "Account" },
];

export function tabsFor(user: SessionUser | null): PartnerTab[] {
  if (!user) return [];

  const has = (p: string) => user.permissions?.includes(p) ?? false;
  const on = (m: string) => user.tenant?.features?.[m] === true;

  return RULES.filter(
    (r) =>
      (!r.permission || has(r.permission)) &&
      (!r.module || on(r.module)) &&
      (!r.shop || r.shop(user)),
  ).map((r) => r.tab);
}

/**
 * Where to land after signing in.
 *
 * Not hardcoded to "Dashboard": a shop whose staff member has neither reports
 * nor orders still gets Dashboard by the rules above, but the day a rule
 * changes, the landing tab must follow the same list rather than name a tab
 * that is no longer there.
 */
export function landingTab(user: SessionUser | null): PartnerTab | null {
  return tabsFor(user)[0] ?? null;
}
