import { describe, expect, it } from "vitest";

import { shopNav } from "./AppSidebar";
import { TENANT_ROUTES as ROUTES } from "../test/routes";

/**
 * Which screens a shop can see.
 *
 * This is where a whole class of defect lives that the backend suite cannot
 * reach. A books-only shop was being offered a Catalog it can never fill, in
 * Full view only, while 1,100 green backend tests said nothing — because the
 * rule is written in TypeScript, in a sidebar.
 *
 * Two things are being pinned here:
 *
 *   - a module or trade that does not have a screen is never offered it, in
 *     EITHER menu mode (Simple and Full must agree about what the business IS,
 *     and differ only in how much of it is on screen)
 *
 *   - every path the nav can produce actually has a route behind it
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

type Mode = "basic" | "advanced";

type Can = (permission: string) => boolean;

/** Every tenant permission — the owner, who holds them all implicitly. */
const OWNER: Can = () => true;

/** A staff member holding exactly these permissions. */
const holding = (...permissions: string[]): Can => (p) => permissions.includes(p);

function nav(type: string, mode: Mode, multiBranch = false, can: Can = OWNER) {
  return shopNav(FEATURES[type], type, mode, multiBranch, can);
}

function paths(type: string, mode: Mode, multiBranch = false, can: Can = OWNER): string[] {
  return nav(type, mode, multiBranch, can).flatMap((item) => [
    ...(item.path ? [item.path] : []),
    ...(item.subItems ?? []).map((sub) => sub.path),
  ]);
}

const TYPES = Object.keys(FEATURES);
const MODES: Mode[] = ["basic", "advanced"];

describe("every nav item leads somewhere", () => {
  for (const type of TYPES) {
    for (const mode of MODES) {
      it(`${type} / ${mode} offers no path without a route`, () => {
        for (const path of paths(type, mode)) {
          expect(ROUTES, `${path} has no route in App.tsx`).toContain(path);
        }
      });
    }
  }
});

describe("a books-only shop is offered only its books", () => {
  // Finance Manager: no till, no catalog, no stock. The defect this pins was
  // live in Full view only — Simple mode had always been right.
  for (const mode of MODES) {
    it(`${mode} mode offers no catalog it can never fill`, () => {
      const nav = paths("finance", mode);

      expect(nav).not.toContain("/tenant/products");
      expect(nav).not.toContain("/tenant/categories");
    });

    it(`${mode} mode offers no selling tools`, () => {
      const nav = paths("finance", mode);

      expect(nav).not.toContain("/tenant/sales");
      expect(nav).not.toContain("/tenant/pos");
      expect(nav).not.toContain("/tenant/day");
      expect(nav).not.toContain("/tenant/coupons");
      expect(nav).not.toContain("/tenant/promotions");
      expect(nav).not.toContain("/tenant/customers");
    });

    it(`${mode} mode still offers the one module it bought`, () => {
      expect(paths("finance", mode)).toContain("/tenant/expenses");
    });
  }
});

describe("the till and the trading day follow the POS module", () => {
  it("a shop with a till can close its day off", () => {
    // Without this a merchant could never close a day or record banking at
    // all — which is why it appears in the calm view too.
    expect(paths("mart", "basic")).toContain("/tenant/day");
    expect(paths("mart", "advanced")).toContain("/tenant/day");
  });

  it("a shop with no till is told nothing about one", () => {
    const online = { expenses: true, products: true, marketplace: true, images: true };

    expect(shopNav(online, "retail", "advanced", false).flatMap((i) => i.path ?? [])).not.toContain("/tenant/day");
  });
});

describe("stock screens follow the stock module", () => {
  it("a mart counts its shelves", () => {
    const nav = paths("mart", "advanced");

    expect(nav).toContain("/tenant/inventory");
    expect(nav).toContain("/tenant/stocktake");
    expect(nav).toContain("/tenant/suppliers");
  });

  it("a restaurant that carries no stock gets no stock chain", () => {
    // Food defaults to no inventory module: a kitchen does not count its
    // shelves the way a grocery does.
    const nav = paths("food", "advanced");

    expect(nav).not.toContain("/tenant/inventory");
    expect(nav).not.toContain("/tenant/stocktake");
  });

  it("a services shop has a catalog but no shelves", () => {
    const nav = paths("services", "advanced");

    expect(nav).toContain("/tenant/products");
    expect(nav).not.toContain("/tenant/stocktake");
  });
});

describe("trade-specific screens go only to the trades that use them", () => {
  it("the chemist's register is pharmacy-only", () => {
    // A mart that happens to stock paracetamol keeps no dispensing register,
    // and the page would be an empty table forever.
    expect(paths("pharmacy", "advanced")).toContain("/tenant/pharmacy");
    expect(paths("mart", "advanced")).not.toContain("/tenant/pharmacy");
  });

  it("vehicles go to the trades that work on vehicles", () => {
    expect(paths("automotive", "advanced")).toContain("/tenant/vehicles");
    expect(paths("petroleum", "advanced")).toContain("/tenant/vehicles");
    expect(paths("mart", "advanced")).not.toContain("/tenant/vehicles");
  });

  it("warranty lookup goes to every trade that sells a serialised unit", () => {
    expect(paths("retail", "advanced")).toContain("/tenant/warranty");
    // Batteries carry a serial and a warranty, and the auto trade is where
    // they are claimed. Locking this to `retail` left the capability built,
    // tested and unreachable for the shops that need it most.
    expect(paths("automotive", "advanced")).toContain("/tenant/warranty");
    expect(paths("petroleum", "advanced")).toContain("/tenant/warranty");
  });

  it("and to nobody who never sells one", () => {
    for (const trade of ["pharmacy", "mart", "food", "services", "finance"]) {
      expect(paths(trade, "advanced"), trade).not.toContain("/tenant/warranty");
    }
  });

  it("a portfolio belongs to a service business, not to a filling station", () => {
    // Petroleum carries the `services` flag for pump labour, but has no
    // portfolio to show off.
    expect(paths("services", "advanced")).toContain("/tenant/portfolio");
    expect(paths("petroleum", "advanced")).not.toContain("/tenant/portfolio");
  });

  it("the forecourt is petroleum-only", () => {
    expect(paths("petroleum", "advanced")).toContain("/tenant/fuel");
    expect(paths("automotive", "advanced")).not.toContain("/tenant/fuel");
  });

  it("dine-in and the kitchen board follow the dine-in module", () => {
    expect(paths("food", "advanced")).toContain("/tenant/dine-in");
    expect(paths("food", "advanced")).toContain("/tenant/kitchen");
    expect(paths("pharmacy", "advanced")).not.toContain("/tenant/dine-in");
  });
});

describe("online screens follow the online modules", () => {
  it("collections merchandise a storefront, so they need one", () => {
    expect(paths("mart", "advanced")).toContain("/tenant/collections");
    expect(paths("automotive", "advanced")).not.toContain("/tenant/collections");
  });

  it("a pharmacy delivering phone orders gets riders without an online store", () => {
    // The exact shop the phone-order flow exists for.
    const nav = paths("pharmacy", "advanced");

    expect(nav).toContain("/tenant/riders");
    expect(nav).not.toContain("/tenant/collections");
  });
});

describe("branches appear only when the shop is allowed more than one", () => {
  it("a single-site shop is not shown a locations manager", () => {
    expect(paths("mart", "advanced", false)).not.toContain("/tenant/branches");
  });

  it("a multi-branch shop is", () => {
    const nav = paths("mart", "advanced", true);

    expect(nav).toContain("/tenant/branches");
    expect(nav).toContain("/tenant/transfers");
  });
});

describe("Simple mode is a smaller menu, not a different business", () => {
  it("never offers a screen Full view withholds", () => {
    for (const type of TYPES) {
      const basic = new Set(paths(type, "basic"));
      const advanced = new Set(paths(type, "advanced"));

      for (const path of basic) {
        expect(advanced, `${type}: ${path} is in Simple but not Full view`).toContain(path);
      }
    }
  });
});

/**
 * The third axis: what this PERSON may do.
 *
 * Module and business type decide what the shop has; neither knows who is
 * looking at it. A cashier holding only sales.manage was being offered Staff,
 * Reports, Suppliers and the whole Expense Manager, and got a 403 from every
 * one — the menu promising something the API refuses.
 */
describe("the menu offers nothing the API will refuse", () => {
  const CASHIER = holding("sales.manage");

  it("a cashier gets the counter and nothing behind it", () => {
    const menu = paths("mart", "advanced", false, CASHIER);

    expect(menu).toContain("/tenant/pos");
    expect(menu).toContain("/tenant/sales");
    expect(menu).toContain("/tenant/day");
    expect(menu).toContain("/tenant/documents");

    expect(menu).not.toContain("/tenant/staff");
    expect(menu).not.toContain("/tenant/reports");
    expect(menu).not.toContain("/tenant/settings");
    expect(menu).not.toContain("/tenant/suppliers");
    expect(menu).not.toContain("/tenant/expenses");
    expect(menu).not.toContain("/tenant/customers");
    expect(menu).not.toContain("/tenant/products");
  });

  it("holds in the calm view too, where a cashier actually works", () => {
    const menu = paths("mart", "basic", false, CASHIER);

    expect(menu).toContain("/tenant/pos");
    expect(menu).toContain("/tenant/day");
    expect(menu).not.toContain("/tenant/settings");
    expect(menu).not.toContain("/tenant/products");
    expect(menu).not.toContain("/tenant/expenses");
  });

  it("a dropdown emptied by permission disappears with its children", () => {
    // An "Inventory" that opens onto nothing is worse than no Inventory at
    // all, and a "More" with no rows is a dead end in the middle of the rail.
    const menu = nav("mart", "advanced", false, CASHIER);
    const names = menu.map((i) => i.name);

    expect(names).not.toContain("Inventory");
    expect(names).not.toContain("Customers");
    expect(names).not.toContain("Expense Manager");
    expect(names).not.toContain("More");
  });

  it("a dropdown keeps the rows the person does hold", () => {
    // A stock-keeper counts and adjusts; buying and paying suppliers is
    // somebody else's job.
    const inventory = nav("mart", "advanced", false, holding("inventory.manage"))
      .find((i) => i.name === "Inventory");

    expect(inventory?.subItems?.map((s) => s.path)).toEqual([
      "/tenant/inventory",
      "/tenant/stocktake",
    ]);
  });

  it("the trade screens carry the permission their own action needs", () => {
    // The dispensing register and the warranty desk are counter work, so a
    // cashier reaches them; the portfolio is what the shop shows the world.
    expect(paths("pharmacy", "advanced", false, CASHIER)).toContain("/tenant/pharmacy");
    expect(paths("retail", "advanced", false, CASHIER)).toContain("/tenant/warranty");
    expect(paths("services", "advanced", false, CASHIER)).not.toContain("/tenant/portfolio");
    expect(paths("services", "advanced", false, holding("settings.manage")))
      .toContain("/tenant/portfolio");
  });

  it("splits the forecourt between the people who run it", () => {
    // A shift is a stock reconciliation, a tanker is goods received, the
    // tanks are configuration. Three screens, three permissions.
    expect(paths("petroleum", "advanced", false, holding("inventory.manage")))
      .toContain("/tenant/fuel");
    expect(paths("petroleum", "advanced", false, holding("inventory.manage")))
      .not.toContain("/tenant/fuel/setup");
    expect(paths("petroleum", "advanced", false, holding("settings.manage")))
      .toContain("/tenant/fuel/setup");
  });

  it("what the shop pays is not hidden from the people who work in it", () => {
    // Deliberate: the server asks for no permission to read the subscription,
    // so the menu must not invent one.
    expect(paths("mart", "advanced", false, CASHIER)).toContain("/tenant/subscription");
  });

  it("an owner is narrowed by nothing", () => {
    // hasPermission returns true for every key an owner is asked about, so
    // the permission axis must be a no-op for them.
    for (const type of TYPES) {
      for (const mode of MODES) {
        expect(paths(type, mode, true, OWNER)).toEqual(paths(type, mode, true, () => true));
      }
    }
  });

  it("still leads somewhere, whoever is looking", () => {
    for (const type of TYPES) {
      for (const mode of MODES) {
        for (const path of paths(type, mode, true, CASHIER)) {
          expect(ROUTES, `${path} has no route in App.tsx`).toContain(path);
        }
      }
    }
  });
});

/**
 * shopNav understands the eight CURRENT codes and nothing else — which is
 * exactly why the tenant payload carries business_type_primary and the sidebar
 * reads that. Hand it a raw legacy code and a real shop loses real screens;
 * this pins the reason the resolved field has to exist.
 */
describe("trade gates need the resolved business type", () => {
  it("an old clinic is a pharmacy or it keeps no register", () => {
    expect(shopNav(FEATURES.pharmacy, "pharmacy", "advanced", false)
      .flatMap((i) => (i.subItems ?? []).map((s) => s.path))).toContain("/tenant/pharmacy");

    expect(shopNav(FEATURES.pharmacy, "clinic", "advanced", false)
      .flatMap((i) => (i.subItems ?? []).map((s) => s.path))).not.toContain("/tenant/pharmacy");
  });

  it("an old workshop is automotive or it keeps no vehicle register", () => {
    expect(shopNav(FEATURES.automotive, "automotive", "advanced", false)
      .flatMap((i) => (i.subItems ?? []).map((s) => s.path))).toContain("/tenant/vehicles");

    expect(shopNav(FEATURES.automotive, "workshop", "advanced", false)
      .flatMap((i) => (i.subItems ?? []).map((s) => s.path))).not.toContain("/tenant/vehicles");
  });
});
