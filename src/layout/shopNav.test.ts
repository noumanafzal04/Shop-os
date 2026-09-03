import { describe, expect, it } from "vitest";

import { shopNav } from "./AppSidebar";
import { TRADE_FEATURES as FEATURES } from "../test/tradeFeatures";
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
    // Quotes & Advances is a retail/services counter's document and a kiryana
    // shop does not start with the module — so the cashier's right to it is
    // asserted where the module actually lives.
    expect(paths("retail", "advanced", false, CASHIER)).toContain("/tenant/documents");

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
    // A stock keeper counts, adjusts, moves stock between branches, and
    // receives what arrives — so they need the supplier's name and the order
    // they are checking the delivery against. RAISING an order and paying a
    // supplier are still somebody else's job; the server draws the line at the
    // same place (Permissions::READS_PURCHASE_ORDERS).
    const inventory = nav("mart", "advanced", false, holding("inventory.manage"))
      .find((i) => i.name === "Inventory");

    expect(inventory?.subItems?.map((s) => s.path)).toEqual([
      "/tenant/inventory",
      // Recording where a removed lot went is batch housekeeping, which is the
      // same job as adjusting stock — so it rides inventory.manage with it.
      "/tenant/disposals",
      "/tenant/stocktake",
      "/tenant/suppliers",
      "/tenant/purchases",
    ]);
  });

  it("buying screens stay shut to someone with neither stock nor purchase authority", () => {
    const menu = nav("mart", "advanced", false, holding("customers.manage"));
    const all = menu.flatMap((i) => i.subItems?.map((s) => s.path) ?? [i.path]);

    expect(all).not.toContain("/tenant/suppliers");
    expect(all).not.toContain("/tenant/purchases");
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
  // Every path the menu offers, wherever it sits. These read the WHOLE nav
  // rather than only its dropdowns — they were written when the trade screens
  // all lived inside "More", and asserting on `subItems` alone would have
  // failed the day one of them was promoted to the top level for being the
  // screen a shop's day runs on. The claim is "this trade is offered its
  // register", not "it is offered it in a dropdown".
  const offers = (type: string) => shopNav(FEATURES[type === "clinic" ? "pharmacy" : type === "workshop" ? "automotive" : type], type, "advanced", false)
    .flatMap((i) => [...(i.path ? [i.path] : []), ...(i.subItems ?? []).map((s) => s.path)]);

  it("an old clinic is a pharmacy or it keeps no register", () => {
    expect(offers("pharmacy")).toContain("/tenant/pharmacy");
    expect(offers("clinic")).not.toContain("/tenant/pharmacy");
  });

  it("an old workshop is automotive or it keeps no vehicle register", () => {
    expect(offers("automotive")).toContain("/tenant/vehicles");
    expect(offers("workshop")).not.toContain("/tenant/vehicles");
  });
});

/**
 * THE MODULE DENOMINATOR — what a shop cannot decline once it has bought one
 * thing.
 *
 * The complaint this answers is a shopkeeper's, not an engineer's: a small
 * takeaway café is shown Disposals, Bank offers and a warehouse's worth of
 * screens that link to nothing it does, and the clutter IS the problem.
 *
 * "Which of these can be turned off?" had no written answer. The registry holds
 * a handful of keys and the menu produces fifty-three paths, so most screens
 * arrive as passengers on a module somebody else bought — switch `inventory` on
 * for a chemist and five more screens come with it, whether or not that chemist
 * has ever disposed of anything.
 *
 * Measured behaviourally rather than by reading the source: switch on ONE
 * module and list what appeared. Whatever appears is what that module drags in,
 * whatever the code looks like — so a screen added as a passenger turns this
 * red on the day it is added, and the ways out are to give it a key of its own
 * or to write down why it is inseparable from its parent.
 */
describe("every screen either has a module of its own, or is written down", () => {
  const KEYS = [
    "products", "services", "pos", "inventory", "expenses", "images",
    "marketplace", "delivery", "reservations", "kitchen", "dine_in", "fuel",
  ];

  const only = (...on: string[]) => Object.fromEntries(KEYS.map((k) => [k, on.includes(k)]));

  const offered = (features: Record<string, boolean>, multiBranch = false) =>
    shopNav(features, "mart", "advanced", multiBranch, OWNER).flatMap((item) => [
      ...(item.path ? [item.path] : []),
      ...(item.subItems ?? []).map((sub) => sub.path),
    ]);

  /**
   * Screens a shop keeps whatever it has bought, and the reason each may.
   *
   * Three honest categories and nothing else belongs here: the shop itself
   * (settings, staff, the bill), the way out (help, the dashboard), and what
   * the PLAN decides rather than a module (branches follow multi-branch, which
   * is bought).
   */
  const NO_MODULE_OF_ITS_OWN: Record<string, string> = {
    "/tenant": "the dashboard is the way into everything else; with nothing on, it says so",
    "/tenant/settings": "a business always has settings — including the switch for what it sells",
    "/tenant/help": "never gated on purpose: anyone can get stuck, and the Help Centre already filters itself to the shop's modules",
    "/tenant/subscription": "what the shop pays is not a module the shop can decline",
    "/tenant/staff": "who works here is not optional for a business with anybody in it",
    "/tenant/activity": "the audit trail of the above — a shop that can grant a permission may ask what was done with it",
    "/tenant/reports": "a business always may read its own numbers",
    "/tenant/branches": "follows the PLAN (multi-branch), not a module",
    "/tenant/transfers": "as above — stock between branches only exists once there are two",
  };

  /**
   * What each module is ALLOWED to bring with it.
   *
   * The line this holds: a passenger is a screen a shop cannot decline, so
   * every one of these is a decision somebody made on the shopkeeper's behalf.
   * Writing them down is what turns "the menu is cluttered" into a list that
   * can be argued with.
   */
  const PASSENGERS: Record<string, readonly string[]> = {
    products: ["/tenant/products", "/tenant/categories"],
    services: ["/tenant/products", "/tenant/categories"],
    pos: ["/tenant/pos", "/tenant/sales", "/tenant/day"],
    // Stock itself. Its tools have their own keys.
    inventory: ["/tenant/products", "/tenant/categories", "/tenant/inventory"],
    // The Expense & Income module IS these four screens.
    expenses: ["/tenant/cashbook", "/tenant/ledger", "/tenant/income", "/tenant/expenses"],
    // A field on a product, not a screen.
    images: [],
    marketplace: ["/tenant/sales", "/tenant/orders", "/tenant/reviews"],
    delivery: ["/tenant/orders", "/tenant/riders"],
    // Sits in the Customers folder, so it needs something to sell first.
    reservations: [],
    // The pass is its own module now: a takeaway counter needs a slip to the
    // kitchen and no floor of tables. `dine_in` depends on it, so a room that
    // seats people still gets both — which is why the board is listed as the
    // KITCHEN module's screen and not the floor's.
    kitchen: ["/tenant/kitchen"],
    dine_in: ["/tenant/dine-in"],
    fuel: ["/tenant/fuel", "/tenant/fuel/deliveries", "/tenant/fuel/setup"],
  };

  const bare = new Set(offered(only(), true));

  it("a shop that has bought nothing is offered nothing unaccounted for", () => {
    const unaccounted = [...bare].filter((p) => !(p in NO_MODULE_OF_ITS_OWN));

    expect(
      unaccounted,
      `${unaccounted.length} screen(s) are shown to a shop that has bought NOTHING: ${unaccounted.join(", ")}. `
        + "Give each a module key in App\\Support\\Modules — registry, route and nav together — or write down why it may stay.",
    ).toEqual([]);
  });

  for (const key of KEYS) {
    it(`${key} brings only what it is written down as bringing`, () => {
      // `inventory` cannot be read alone: it depends on `products`, and
      // Modules::normalize would switch it straight back off.
      const on = key === "inventory" ? ["inventory", "products"] : [key];
      const dragged = [...new Set(offered(only(...on)))]
        .filter((p) => !bare.has(p))
        .filter((p) => !(PASSENGERS[key] ?? []).includes(p))
        .filter((p) => !on.slice(1).some((dep) => (PASSENGERS[dep] ?? []).includes(p)));

      expect(
        dragged,
        `switching on "${key}" also gave the shop ${dragged.join(", ")} — screens it cannot decline. `
          + "Either give each one its own key (with `depends` on this module) or add it to PASSENGERS with the reason "
          + "it is inseparable from its parent.",
      ).toEqual([]);
    });
  }

  it("and nothing is written down that no menu offers any more", () => {
    // The direction a list like this always rots in: an excuse outliving the
    // screen it excused.
    const everywhere = new Set(TYPES.flatMap((t) => MODES.flatMap((m) => paths(t, m, true))));
    const stale = [
      ...Object.keys(NO_MODULE_OF_ITS_OWN),
      ...Object.values(PASSENGERS).flat(),
    ].filter((p) => !everywhere.has(p));

    expect(stale, `written down and offered by nothing: ${stale.join(", ")}`).toEqual([]);
  });
});

/**
 * THE OPTIONAL TOOLS — the eight screens a shop can now decline.
 *
 * Each of these used to arrive as a passenger on a module somebody else bought:
 * switch `inventory` on and a chemist was handed Disposals, Stocktake, Barcode
 * Labels, Suppliers and Purchases; own a till and you were handed a customer
 * book, Coupons, Promotions and Bank card offers.
 *
 * Two things are pinned per tool, because one without the other is how a
 * half-gate ships: the screen goes when the module goes, and the screen comes
 * back when it returns. A test that only proved the first would pass over a
 * module whose switch does nothing but hide things for ever.
 */
describe("the optional tools appear only when their module is on", () => {
  const TOOLS: Array<{ key: string; paths: string[]; needs: string[] }> = [
    { key: "purchasing", paths: ["/tenant/suppliers", "/tenant/purchases"], needs: ["products", "inventory"] },
    { key: "stocktake", paths: ["/tenant/stocktake"], needs: ["products", "inventory"] },
    { key: "disposals", paths: ["/tenant/disposals"], needs: ["products", "inventory"] },
    { key: "labels", paths: ["/tenant/labels"], needs: ["products", "inventory"] },
    { key: "customers", paths: ["/tenant/customers"], needs: ["pos", "products"] },
    { key: "promotions", paths: ["/tenant/coupons", "/tenant/promotions"], needs: ["pos", "products"] },
    { key: "bank_offers", paths: ["/tenant/bank-offers"], needs: ["pos", "products", "promotions"] },
    { key: "documents", paths: ["/tenant/documents"], needs: ["pos"] },
  ];

  const menu = (features: Record<string, boolean>) =>
    shopNav(features, "retail", "advanced", false, OWNER).flatMap((item) => [
      ...(item.path ? [item.path] : []),
      ...(item.subItems ?? []).map((sub) => sub.path),
    ]);

  for (const tool of TOOLS) {
    const base = Object.fromEntries(tool.needs.map((k) => [k, true]));

    it(`${tool.key} on → its screens are offered`, () => {
      const offered = menu({ ...base, [tool.key]: true });

      for (const path of tool.paths) {
        expect(offered, `${tool.key} is on and ${path} is not in the menu`).toContain(path);
      }
    });

    it(`${tool.key} off → its screens are gone, and nothing else is`, () => {
      const withIt = menu({ ...base, [tool.key]: true });
      const without = menu({ ...base, [tool.key]: false });

      for (const path of tool.paths) {
        expect(without, `${tool.key} is off and ${path} is still in the menu`).not.toContain(path);
      }

      // The other half, and the one that catches a gate written too wide: a
      // switch must take ITS screens and no others. Turning promotions off
      // once took the whole Customers folder with it.
      const alsoLost = withIt.filter((p) => !without.includes(p) && !tool.paths.includes(p));
      expect(
        alsoLost,
        `switching "${tool.key}" off also removed ${alsoLost.join(", ")} — a gate written wider than the module it names`,
      ).toEqual([]);
    });
  }

  it("the Customers folder goes when everything inside it does, and not before", () => {
    // An empty dropdown is worse than a missing one: it is a thing to press
    // that does nothing. But it must not vanish while a row survives.
    const sells = { pos: true, products: true };

    expect(menu({ ...sells, customers: true })).toContain("/tenant/customers");
    expect(menu({ ...sells, promotions: true })).toContain("/tenant/coupons");

    const none = menu(sells);
    for (const path of ["/tenant/customers", "/tenant/coupons", "/tenant/promotions", "/tenant/bank-offers"]) {
      expect(none).not.toContain(path);
    }
  });

  it("a cash-only takeaway counter is offered none of them", () => {
    // The shop this whole change is for: a small café that rings up, hands
    // over, and has never disposed of anything or run a bank card offer.
    const cafe = menu({ pos: true, products: true, dine_in: true, expenses: true });

    for (const tool of TOOLS) {
      for (const path of tool.paths) {
        expect(cafe, `a takeaway café was offered ${path}`).not.toContain(path);
      }
    }

    // And it still has everything it DOES use.
    expect(cafe).toContain("/tenant/pos");
    expect(cafe).toContain("/tenant/dine-in");
    expect(cafe).toContain("/tenant/sales");
    expect(cafe).toContain("/tenant/day");
    expect(cafe).toContain("/tenant/products");
  });
});
