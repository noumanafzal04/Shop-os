import { describe, expect, it } from "vitest";

import { canVisit, mappedScreens, permissionForScreen } from "./screenPermissions";
import { TENANT_ROUTES } from "../../test/routes";

/**
 * One map, read by three surfaces.
 *
 * The sidebar filters on it, the dashboard tiles filter on it, and the route
 * guards enforce it. That is the point — a cashier was being offered a "Owed
 * to you Rs 4,000" tile on the dashboard hours after the sidebar had learnt
 * not to offer them the customers screen, because each surface carried its own
 * idea of the rule.
 *
 * So the map itself needs pinning: every entry has to name a real screen, and
 * every screen left OUT of it has to be left out deliberately.
 */

/**
 * The permissions the server actually defines (App\Support\Permissions).
 * Naming one that doesn't exist locks a screen against everybody but the
 * owner, silently and forever.
 */
const TENANT_PERMISSIONS = new Set([
  "staff.manage",
  "products.manage",
  "inventory.manage",
  "suppliers.manage",
  "purchases.manage",
  "sales.manage",
  "discounts.apply",
  "discounts.override",
  "sales.void",
  "sales.refund",
  "customers.manage",
  "coupons.manage",
  "expenses.manage",
  "reports.view",
  "reservations.manage",
  "orders.manage",
  "settings.manage",
]);

/**
 * The screens anyone signed in to the shop may open, and WHY — because
 * "I forgot to add it to the map" looks exactly like "it is open on purpose"
 * unless the list is written down.
 *
 *   /tenant              the dashboard is everyone's home, and where a
 *                        refused gate sends you; gating it is a redirect loop
 *   /tenant/setup        an unfinished shop must be finishable
 *   /tenant/subscription the server asks for no permission to read it
 *   /tenant/security     your own password — everyone signed in has one
 *   /tenant/help         anyone can get stuck. What the Help Centre SHOWS is
 *                        filtered by the shop's modules and by what the reader
 *                        can open, so an open door here reveals nothing a
 *                        permission would have hidden
 */
const DELIBERATELY_OPEN = [
  "/tenant",
  "/tenant/help",
  "/tenant/security",
  "/tenant/setup",
  "/tenant/subscription",
];

describe("the map describes screens that exist", () => {
  it("guards no screen the app does not have", () => {
    // A rule for a deleted or renamed screen guards nothing, and reads as
    // coverage it is not giving.
    for (const path of mappedScreens()) {
      expect(TENANT_ROUTES, `${path} is guarded but has no route`).toContain(path);
    }
  });

  it("names only permissions the server defines", () => {
    // A typo here locks the screen against everybody but the owner —
    // silently, because a permission nobody holds simply never matches.
    for (const path of mappedScreens()) {
      const permission = permissionForScreen(path);

      expect(TENANT_PERMISSIONS, `${path} → ${permission}`).toContain(permission);
    }
  });
});

describe("nothing falls through the map by accident", () => {
  it("leaves exactly these screens open, and they are the ones we chose", () => {
    // This is the test that catches the real mistake: adding a screen and
    // forgetting to say who may open it. An unmapped screen is open to every
    // cashier in the shop, and nothing else would ever mention it.
    const open = [...TENANT_ROUTES].filter((path) => permissionForScreen(path) === null);

    expect(open.sort()).toEqual([...DELIBERATELY_OPEN].sort());
  });
});

describe("canVisit asks the caller what may means", () => {
  const holding = (...permissions: string[]) => (p: string) => permissions.includes(p);

  it("lets an unmapped screen through for anyone", () => {
    expect(canVisit("/tenant", holding())).toBe(true);
    expect(canVisit("/tenant/subscription", holding())).toBe(true);
  });

  it("holds a mapped screen against someone without its permission", () => {
    expect(canVisit("/tenant/customers", holding("sales.manage"))).toBe(false);
    expect(canVisit("/tenant/customers", holding("customers.manage"))).toBe(true);
  });

  it("opens everything for a predicate that says yes — the owner", () => {
    for (const path of TENANT_ROUTES) {
      expect(canVisit(path, () => true), path).toBe(true);
    }
  });

  it("closes every gated screen for a person holding nothing", () => {
    const closed = [...TENANT_ROUTES].filter((path) => !canVisit(path, () => false));

    expect(closed.length).toBe(TENANT_ROUTES.size - DELIBERATELY_OPEN.length);
  });
});

describe("the counter's screens travel together", () => {
  it("gives a cashier the till, the day and the two counter lookups", () => {
    // These five are one job. Splitting them would mean a cashier who can
    // ring a sale but cannot look up the warranty on the phone in their hand.
    const cashier = (p: string) => p === "sales.manage";

    for (const path of [
      "/tenant/pos",
      "/tenant/sales",
      "/tenant/day",
      "/tenant/documents",
      "/tenant/warranty",
      "/tenant/pharmacy",
    ]) {
      expect(canVisit(path, cashier), path).toBe(true);
    }
  });

  it("does not give them the back office", () => {
    const cashier = (p: string) => p === "sales.manage";

    for (const path of [
      "/tenant/staff",
      "/tenant/reports",
      "/tenant/settings",
      "/tenant/customers",
      "/tenant/suppliers",
      "/tenant/inventory",
      "/tenant/expenses",
      "/tenant/products",
    ]) {
      expect(canVisit(path, cashier), path).toBe(false);
    }
  });
});
