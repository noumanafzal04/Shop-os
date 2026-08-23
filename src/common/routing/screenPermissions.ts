/**
 * Which permission each shop screen needs — one map, one rule.
 *
 * The permission named here is the one the SERVER asks for on that screen's
 * own action (see routes/api.php). Nothing invents a rule the API does not
 * have, and nothing quietly drops one it does.
 *
 * Every surface that OFFERS a screen reads this: the sidebar, the dashboard
 * tiles, the dashboard alert rows, the quick actions. That matters more than
 * it looks — the sidebar was the first to be filtered, and within a day the
 * dashboard was offering a cashier a "Owed to you Rs 4,000" tile that bounced
 * them straight back. Two lists of the same rule is how they drift.
 *
 * A path absent from this map is open to anyone signed in to the shop, which
 * is deliberate for three of them:
 *
 *   /tenant              the dashboard is everyone's home, and the redirect
 *                        target when a gate refuses — it can never be gated
 *   /tenant/subscription the server asks for no permission; what the shop
 *                        pays is not a secret from the people who work in it
 *   /tenant/setup        an unfinished shop must be finishable
 *   /tenant/security     your own password — everyone signed in has one
 */
/**
 * A screen may name SEVERAL permissions, and then it reads as ANY of them —
 * the same shape the server's permission gate uses. Receiving a delivery is
 * the clearest case: raising a purchase order is buying, but checking the
 * goods off the loading bay is stockroom work, and the two are different
 * people. A single-permission map could not say that, so the person hired to
 * receive stock had no Purchases menu at all.
 */
const SCREEN_PERMISSIONS: Record<string, string | string[]> = {
  // The counter. A cashier is entitled to the record of their own drawer, so
  // the day and its banking sit here too — CLOSING a day off is manager-only
  // and enforced on the server, not by hiding the screen.
  "/tenant/pos": "sales.manage",
  "/tenant/dine-in": "sales.manage",
  // The pass takes EITHER key. A kitchen hand holds kitchen.manage alone, so
  // the board is all they are offered; in a small kitchen the same person cooks
  // and rings up and already holds sales.manage.
  "/tenant/kitchen": ["sales.manage", "kitchen.manage"],
  "/tenant/sales": "sales.manage",
  "/tenant/sales/new": "sales.manage",
  "/tenant/day": "sales.manage",
  "/tenant/documents": "sales.manage",
  // Counter lookups: the chemist's register and the warranty desk are both
  // things done with a customer standing there.
  "/tenant/pharmacy": "sales.manage",
  "/tenant/warranty": "sales.manage",

  "/tenant/orders": "orders.manage",
  "/tenant/riders": "orders.manage",

  // The forecourt splits three ways: a shift ends by setting fuel stock to
  // the dip (a stock correction), a tanker is goods received, the plant is
  // configuration.
  "/tenant/fuel": "inventory.manage",
  "/tenant/fuel/deliveries": "purchases.manage",
  "/tenant/fuel/setup": "settings.manage",

  "/tenant/cashbook": "expenses.manage",
  "/tenant/income": "expenses.manage",
  "/tenant/expenses": "expenses.manage",
  "/tenant/ledger": "expenses.manage",

  // Catalog — including the label sheet, which prints from the catalog record
  // rather than off the shelf.
  "/tenant/products": "products.manage",
  "/tenant/products/new": "products.manage",
  "/tenant/categories": "products.manage",
  "/tenant/collections": "products.manage",
  "/tenant/labels": "products.manage",

  "/tenant/inventory": "inventory.manage",
  // The record of stock leaving the shelf IS batch housekeeping, so it rides
  // the same permission the batches themselves do.
  "/tenant/disposals": "inventory.manage",
  "/tenant/stocktake": "inventory.manage",
  "/tenant/transfers": "inventory.manage",
  // Naming who a delivery came from, and receiving against the order, are
  // both stockroom work. Editing the vendor directory and raising an order
  // are not — the server draws the same line (Permissions::READS_SUPPLIERS,
  // READS_PURCHASE_ORDERS).
  "/tenant/suppliers": ["suppliers.manage", "purchases.manage", "inventory.manage"],
  "/tenant/purchases": ["purchases.manage", "inventory.manage"],

  // A vehicle IS customer data — the plate is how an auto shop finds a person.
  "/tenant/customers": "customers.manage",
  "/tenant/vehicles": "customers.manage",
  // The bay board is a till screen: moving a car along it is what a mechanic
  // does all day, and gating it on the CRM permission would mean handing that
  // permission to everybody who touches a car.
  "/tenant/workshop": "sales.manage",
  "/tenant/coupons": "coupons.manage",
  "/tenant/promotions": "coupons.manage",
  // Signing a deal with a bank is marketing, not a settings switch — the same
  // permission promotions and coupons ride, for the same reason.
  "/tenant/bank-offers": "coupons.manage",
  "/tenant/reservations": "reservations.manage",
  // Replying is the only thing anyone does on the reviews screen.
  "/tenant/reviews": "settings.manage",

  "/tenant/reports": "reports.view",
  "/tenant/staff": "staff.manage",
  // The portfolio is what the shop shows the world.
  "/tenant/portfolio": "settings.manage",
  "/tenant/branches": "settings.manage",
  "/tenant/settings": "settings.manage",
  // The shop's own record of who changed what. An ANY-of list, mirroring the
  // server's READS_AUDIT: the person most often being ASKED about is the one
  // holding settings.manage, and a trail only they can open is not a trail.
  "/tenant/activity": ["settings.manage", "reports.view"],
};

/**
 * The permission a screen needs, or null when anyone in the shop may open it.
 * Where a screen accepts several, this returns the first — enough to name the
 * rule, not enough to evaluate it. Use canVisit() to decide.
 */
export function permissionForScreen(path: string): string | null {
  const rule = SCREEN_PERMISSIONS[path];
  if (rule === undefined) return null;

  return Array.isArray(rule) ? rule[0] : rule;
}

/** Every permission that opens a screen, in the order they are declared. */
export function permissionsForScreen(path: string): string[] {
  const rule = SCREEN_PERMISSIONS[path];
  if (rule === undefined) return [];

  return Array.isArray(rule) ? rule : [rule];
}

/**
 * Every screen the map has a rule for. Exported so the tests can check the map
 * from both directions — an entry naming a screen that no longer exists is a
 * rule guarding nothing, and reads as coverage it isn't giving.
 */
export function mappedScreens(): string[] {
  return Object.keys(SCREEN_PERMISSIONS);
}

/**
 * May this person open that screen?
 *
 * Pass the `can` predicate the caller already holds (the sidebar's, or the
 * dashboard's) so there is still exactly one place that decides what "may"
 * means for an owner versus a staff member.
 */
export function canVisit(path: string, can: (permission: string) => boolean): boolean {
  const permissions = permissionsForScreen(path);

  return permissions.length === 0 || permissions.some(can);
}

/**
 * The rule that governs an ACTUAL url, including one with an id in it.
 *
 * The map names screens; a browser is at `/tenant/documents/9f2c…`. A child
 * screen is governed by its parent — the detail of a document is the documents
 * screen — so the longest mapped ancestor wins, and `/tenant/fuel/setup` still
 * beats `/tenant/fuel` for a path under it.
 *
 * Matching is by SEGMENT. A prefix compared as a string makes `/tenant/salesmen`
 * a child of `/tenant/sales`, which is how a rule ends up governing a screen
 * nobody meant it to.
 */
export function screenGoverning(pathname: string): string | null {
  const segments = pathname.replace(/\/+$/, "").split("/");

  for (let n = segments.length; n > 1; n--) {
    const candidate = segments.slice(0, n).join("/");
    if (candidate in SCREEN_PERMISSIONS) return candidate;
  }

  return null;
}

/**
 * May this person be at this url?
 *
 * The route guard's question, and deliberately the same function the sidebar
 * and the dashboard tiles answer with — see `RequireTenantScreen`. Four
 * surfaces offering a screen and a fifth deciding who gets in is how a kitchen
 * hand came to be shown a Kitchen link that bounced them to the dashboard.
 */
export function canBeAt(pathname: string, can: (permission: string) => boolean): boolean {
  const screen = screenGoverning(pathname);

  return screen === null || canVisit(screen, can);
}
