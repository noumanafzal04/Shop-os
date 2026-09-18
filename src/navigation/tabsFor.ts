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
    /**
     * `products`, NOT `marketplace` — and this gate was written the wrong way
     * round first, which is worth leaving here.
     *
     * The obvious rule is "a shop that does not sell online has no orders", so
     * the first version asked `online_shop_enabled`. The server already knows
     * better and says so on the route itself: *"Gated on `products`, not
     * `marketplace`: a pharmacy that delivers but sells nothing online has
     * marketplace off, and gating here meant it could manage riders and never
     * see an order to give one."*
     *
     * A shop takes orders by phone and over WhatsApp too — `POST /orders`
     * exists for exactly that. Asking `online_shop_enabled` would have hidden
     * this tab from the shops that need it most, and an absent tab looks like
     * a decision rather than a mistake.
     *
     * The gate matching the ROUTE is the point. A tab offered where the API
     * refuses, or withheld where it would answer, are the same bug in
     * different directions.
     */
    module: "products",
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
