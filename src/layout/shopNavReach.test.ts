import { describe, expect, it } from "vitest";

import { shopNav } from "./AppSidebar";
import { TENANT_ROUTES } from "../test/routes";

/**
 * Can every screen be REACHED?
 *
 * shopNav.test.ts asks the first half of the question — does every path the
 * menu offers have a route behind it. This file asks the other half, which no
 * test was asking: does every route have a menu that offers it, for at least
 * one kind of shop?
 *
 * A page nobody can navigate to is not a small defect. It is a screen that was
 * built, wired, permission-gated and then orphaned — reachable only by typing
 * the URL, which no shopkeeper does. The two directions catch opposite
 * mistakes: a dead link is a menu pointing at nothing, an orphan is something
 * with no menu pointing at it.
 *
 * The eight types below are the CANONICAL ones. The other nine business codes
 * (restaurant, grocery, clinic, salon, workshop, service, wholesale, books,
 * hardware) resolve onto these via BusinessTypes::primary, so eight covers all
 * seventeen — and shopNav.test.ts separately pins that resolution.
 */

/** Module maps mirroring BusinessTypes::defaultFeatures on the server. */
const FEATURES: Record<string, Record<string, boolean>> = {
  food: { expenses: true, images: true, pos: true, products: true, marketplace: true, delivery: true, dine_in: true },
  mart: { expenses: true, images: true, pos: true, products: true, inventory: true, marketplace: true, delivery: true },
  pharmacy: { expenses: true, pos: true, products: true, inventory: true, delivery: true },
  retail: { expenses: true, images: true, pos: true, products: true, inventory: true, marketplace: true, reservations: true, delivery: true },
  services: { expenses: true, pos: true, services: true },
  automotive: { expenses: true, pos: true, products: true, services: true, inventory: true },
  finance: { expenses: true },
  petroleum: { expenses: true, pos: true, products: true, services: true, inventory: true, fuel: true },
};

/** Every path the menu can produce for a given shop, owner looking. */
function pathsFor(type: string, mode: "basic" | "advanced", multiBranch: boolean): string[] {
  const nav = shopNav(FEATURES[type], type, mode, multiBranch, () => true);
  const out: string[] = [];
  for (const item of nav) {
    if (item.path) out.push(item.path);
    for (const sub of item.subItems ?? []) out.push(sub.path);
  }
  return out;
}

/** The union across every shop shape — anything an owner can ever click. */
function everyReachablePath(): Set<string> {
  const all = new Set<string>();
  for (const type of Object.keys(FEATURES)) {
    for (const mode of ["basic", "advanced"] as const) {
      for (const multiBranch of [false, true]) {
        for (const p of pathsFor(type, mode, multiBranch)) all.add(p);
      }
    }
  }
  return all;
}

/**
 * Routes that no menu is ever expected to offer, with the reason. Anything not
 * listed here MUST be reachable, or the test fails — so a newly orphaned screen
 * has to be justified here on purpose rather than by accident.
 */
const NOT_IN_MENU: Record<string, string> = {
  "/tenant/setup": "the setup wizard runs before a menu exists",
  "/tenant/sales/new": "reached from the Sales screen, not the menu",
  "/tenant/orders/new": "reached from the Orders screen, not the menu",
  "/tenant/products/new": "reached from the Products screen, not the menu",
  "/tenant/security": "your own password — reached from the avatar menu",
};

describe("every screen is reachable from some shop's menu", () => {
  const reachable = everyReachablePath();

  it("offers no path without a route (both directions of the contract)", () => {
    const dead = [...reachable].filter((p) => !TENANT_ROUTES.has(p));
    expect(dead, `menu offers paths with no route: ${dead.join(", ")}`).toEqual([]);
  });

  it("leaves no route orphaned — every screen has a menu that offers it", () => {
    const orphans = [...TENANT_ROUTES]
      .filter((p) => !reachable.has(p))
      .filter((p) => !(p in NOT_IN_MENU));
    expect(
      orphans,
      `built but unreachable from any menu: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("gives every business type a menu with something in it", () => {
    for (const type of Object.keys(FEATURES)) {
      const paths = pathsFor(type, "advanced", false);
      expect(paths.length, `${type} has an empty menu`).toBeGreaterThan(0);
    }
  });
});

