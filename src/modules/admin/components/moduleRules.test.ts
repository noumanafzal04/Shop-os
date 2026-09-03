import { describe, expect, it } from "vitest";

import { applyModuleChange, settle } from "./moduleRules";
import type { ModuleInfo } from "../services/adminService";

/**
 * What one switch does to the rest of the map.
 *
 * The rule used to live in the create page and again in the detail page, and
 * neither could switch a dependency ON — they greyed the row out and left the
 * admin to work out which of nineteen switches to find first. One copy now, and
 * both directions tested, because a picker that only settles downward is a
 * picker with half a rule in it.
 */

const CATALOG: ModuleInfo[] = [
  { key: "products", label: "Products", description: "", group: "Selling", depends: [] },
  { key: "pos", label: "Point of Sale", description: "", group: "Selling", depends: [] },
  { key: "documents", label: "Quotes & Advances", description: "", group: "Selling", depends: ["pos"] },
  { key: "inventory", label: "Inventory", description: "", group: "Stock", depends: ["products"] },
  { key: "purchasing", label: "Suppliers & Purchases", description: "", group: "Stock", depends: ["inventory"] },
  { key: "disposals", label: "Disposals", description: "", group: "Stock", depends: ["inventory"] },
  { key: "promotions", label: "Coupons & Promotions", description: "", group: "Customers & offers", depends: [] },
  { key: "bank_offers", label: "Bank Card Offers", description: "", group: "Customers & offers", depends: ["promotions"] },
  { key: "images", label: "Product Images", description: "", group: "Online", depends: ["products"] },
  { key: "marketplace", label: "Online Store", description: "", group: "Online", depends: ["products"] },
];

const on = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, true]));

describe("switching a module ON pulls up what it stands on", () => {
  it("grants the whole chain, not just the module that was pressed", () => {
    // Suppliers & Purchases → Inventory → Products. Asking for the top of a
    // chain plainly means asking for the chain; the old screens answered by
    // refusing the press.
    const change = applyModuleChange(CATALOG, {}, "purchasing", true);

    expect(change.modules.purchasing).toBe(true);
    expect(change.modules.inventory).toBe(true);
    expect(change.modules.products).toBe(true);
  });

  it("says what else it switched on, and does not name the press itself", () => {
    const change = applyModuleChange(CATALOG, {}, "purchasing", true);

    expect(change.alsoOn).toEqual(["Products", "Inventory"]);
    expect(change.alsoOn).not.toContain("Suppliers & Purchases");
    expect(change.alsoOff).toEqual([]);
  });

  it("says nothing when nothing else moved", () => {
    // A module with no dependencies, on a map that already has everything it
    // needs. A screen that announced a ripple every time would train an admin
    // to stop reading it.
    const change = applyModuleChange(CATALOG, on("products"), "pos", true);

    expect(change.alsoOn).toEqual([]);
    expect(change.alsoOff).toEqual([]);
  });

  it("does not switch on anything the pressed module does not need", () => {
    const change = applyModuleChange(CATALOG, {}, "disposals", true);

    expect(change.modules.marketplace).toBe(false);
    expect(change.modules.pos).toBe(false);
    expect(change.modules.promotions).toBe(false);
  });
});

describe("switching a module OFF drops what stood on it", () => {
  it("takes the whole tree with it", () => {
    const start = on("products", "inventory", "purchasing", "disposals");
    const change = applyModuleChange(CATALOG, start, "inventory", false);

    expect(change.modules.inventory).toBe(false);
    expect(change.modules.purchasing).toBe(false);
    expect(change.modules.disposals).toBe(false);
    // And nothing beyond the tree.
    expect(change.modules.products).toBe(true);
  });

  it("names every screen the shop is about to lose", () => {
    const start = on("products", "inventory", "purchasing", "disposals");
    const change = applyModuleChange(CATALOG, start, "inventory", false);

    expect(change.alsoOff).toEqual(["Suppliers & Purchases", "Disposals"]);
    expect(change.alsoOn).toEqual([]);
  });

  it("drops a dependant two levels down", () => {
    // products → inventory → purchasing. Taking the bottom out must not leave
    // the top standing on nothing.
    const change = applyModuleChange(CATALOG, on("products", "inventory", "purchasing"), "products", false);

    expect(change.modules.purchasing).toBe(false);
    expect(change.alsoOff).toContain("Suppliers & Purchases");
  });
});

describe("selling online always means photos", () => {
  it("forces images on with the store", () => {
    // An online listing with no picture is a listing nobody buys from, and the
    // server already treats it that way — writing it into the map keeps the
    // stored answer honest instead of true-in-effect and false-on-screen.
    const change = applyModuleChange(CATALOG, on("products"), "marketplace", true);

    expect(change.modules.images).toBe(true);
    expect(change.alsoOn).toContain("Product Images");
  });

  it("and a walk-in shop may still decline them", () => {
    const change = applyModuleChange(CATALOG, on("products", "images"), "images", false);

    expect(change.modules.images).toBe(false);
  });
});

describe("the map that reaches the server", () => {
  it("has every key as a boolean, so absent is never mistaken for off", () => {
    const change = applyModuleChange(CATALOG, {}, "pos", true);

    for (const m of CATALOG) {
      expect(typeof change.modules[m.key], `${m.key} is not a boolean`).toBe("boolean");
    }
  });

  it("settles a proposed map the same way the server will", () => {
    // What a business type proposes is not always self-consistent — and a map
    // the admin never touched must still be the map that gets saved.
    const settled = settle(CATALOG, { purchasing: true, bank_offers: true });

    expect(settled.purchasing).toBe(false);
    expect(settled.bank_offers).toBe(false);
  });

  it("is stable: pressing a switch that is already on changes nothing", () => {
    const start = applyModuleChange(CATALOG, {}, "purchasing", true).modules;
    const again = applyModuleChange(CATALOG, start, "purchasing", true);

    expect(again.modules).toEqual(start);
    expect(again.alsoOn).toEqual([]);
    expect(again.alsoOff).toEqual([]);
  });
});
