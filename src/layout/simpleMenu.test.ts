import { describe, expect, it } from "vitest";

import { TRADE_FEATURES as FEATURES } from "../test/tradeFeatures";
import { shopMenuInFull, shopNav } from "./shopNav";
import {
  ALWAYS_SHOWN, NO_CHOICE, asChoice, isOwnChoice, keepOnly, pathsOf, simplePaths, tidy, usualPaths, withSwitched,
  type SimpleChoice,
} from "./simpleMenu";

/**
 * A PERSON'S SIMPLE VIEW.
 *
 *     "simple view hoga usmain daily base py use hony waly menus according to
 *      permissions — ya wo khud add kr skty … toggle to add menu or sub menu"
 *
 * Three promises, and each has a way to be broken quietly:
 *
 *   it starts as the day's work               (a hand-written second menu drifts)
 *   a person can put anything they may open on it, and take anything off
 *   and nothing kept on a device can show them a screen they may not have
 */

type Can = (permission: string) => boolean;
const OWNER: Can = () => true;
const holding = (...permissions: string[]): Can => (p) => permissions.includes(p);

const full = (type: string, multiBranch = false, can: Can = OWNER) =>
  shopMenuInFull(FEATURES[type], type, multiBranch, can);

const simple = (type: string, mine: SimpleChoice = NO_CHOICE, multiBranch = false, can: Can = OWNER) =>
  shopNav(FEATURES[type], type, "basic", multiBranch, can, mine);

const names = (type: string, mine?: SimpleChoice, multiBranch = false) => simple(type, mine, multiBranch).map((i) => i.name);

describe("Simple view starts as the day's work", () => {
  it("a grocer's: the till, the sales, the day, and the three things a day touches", () => {
    const menu = names("mart");

    for (const row of ["Dashboard", "POS", "Sales", "Day & banking", "Products", "Inventory", "Expense Manager", "Settings", "Help Centre"]) {
      expect(menu, row).toContain(row);
    }
    // The back office is one switch away, not in the way.
    for (const row of ["Purchases", "Customers", "Offers & discounts", "Reports", "Staff", "Subscription"]) {
      expect(menu, row).not.toContain(row);
    }
  });

  it("everything filed under Daily work is on it — the heading means what it says", () => {
    for (const type of Object.keys(FEATURES)) {
      const daily = pathsOf(full(type, true).filter((item) => item.section === "Daily work"));
      const shown = new Set(pathsOf(simple(type, NO_CHOICE, true)));

      for (const path of daily) expect(shown, `${type}: ${path} is daily work and not on the Simple view`).toContain(path);
    }
  });

  it("the products and the stock are one press, not a dropdown of one", () => {
    const menu = simple("mart");

    expect(menu.find((i) => i.name === "Products")?.path).toBe("/tenant/products");
    expect(menu.find((i) => i.name === "Inventory")?.path).toBe("/tenant/inventory");
  });

  it("a shop with a second place keeps what moves between them", () => {
    const stock = simple("mart", NO_CHOICE, true).find((i) => i.name === "Inventory");

    expect(stock?.subItems?.map((s) => s.path)).toEqual(["/tenant/inventory", "/tenant/stock-by-place", "/tenant/transfers"]);
    expect(names("mart", NO_CHOICE, true)).toContain("Branches & warehouses");
  });

  it("is never empty and never more than the full menu", () => {
    for (const type of Object.keys(FEATURES)) {
      const all = new Set(pathsOf(full(type, true)));
      const shown = pathsOf(simple(type, NO_CHOICE, true));

      expect(shown.length, type).toBeGreaterThan(2);
      for (const path of shown) expect(all, `${type}: ${path}`).toContain(path);
    }
  });
});

describe("a person puts their own screens on it", () => {
  const mart = full("mart");
  const choose = (paths: string[], on: boolean, from: SimpleChoice = NO_CHOICE) => withSwitched(mart, from, paths, on);

  it("a screen switched on appears, under the same name and group as in Full view", () => {
    const mine = choose(["/tenant/purchases"], true);

    expect(mine).toEqual({ add: ["/tenant/purchases"], drop: [] });
    // One screen of the group: a link, named for the group it is the home of.
    expect(simple("mart", mine).find((i) => i.name === "Purchases")?.path).toBe("/tenant/purchases");
  });

  it("a second screen of the same group makes it a group again", () => {
    const mine = choose(["/tenant/purchases", "/tenant/suppliers"], true);
    const purchases = simple("mart", mine).find((i) => i.name === "Purchases");

    expect(purchases?.subItems?.map((s) => s.name)).toEqual(["Purchase orders", "Suppliers"]);
  });

  it("a sub-menu on its own is a link that says where it goes", () => {
    const menu = simple("mart", choose(["/tenant/suppliers"], true));

    expect(menu.find((i) => i.path === "/tenant/suppliers")?.name).toBe("Suppliers");
    expect(menu.find((i) => i.name === "Purchases")).toBeUndefined();
  });

  it("a usual screen switched off is gone, and its group with it when nothing is left", () => {
    const mine = choose(["/tenant/cashbook", "/tenant/ledger", "/tenant/income", "/tenant/expenses"], false);

    expect(mine.drop).toHaveLength(4);
    expect(names("mart", mine)).not.toContain("Expense Manager");
  });

  it("the dashboard cannot be switched off — a menu with nothing on it has no way back", () => {
    const mine = choose(pathsOf(mart), false);

    expect(mine.drop).not.toContain(ALWAYS_SHOWN);
    expect(pathsOf(simple("mart", mine))).toEqual([ALWAYS_SHOWN]);
  });

  it("putting a row back by hand leaves nothing behind", () => {
    const off = choose(["/tenant/sales"], false);
    expect(isOwnChoice(mart, off)).toBe(true);

    const back = choose(["/tenant/sales"], true, off);
    expect(back).toEqual(NO_CHOICE);
    expect(isOwnChoice(mart, back)).toBe(false);

    // …and the same the other way round.
    expect(choose(["/tenant/reports"], false, choose(["/tenant/reports"], true))).toEqual(NO_CHOICE);
  });
});

describe("what a device remembers cannot widen what a person may open", () => {
  it("a screen the shop does not have is not shown, whatever was saved", () => {
    // Saved while the shop had the kitchen module; it no longer does.
    const mine: SimpleChoice = { add: ["/tenant/kitchen", "/tenant/fuel", "/tenant/not-a-screen"], drop: [] };

    expect(pathsOf(simple("mart", mine))).toEqual(pathsOf(simple("mart")));
  });

  it("a screen the person may not open is not shown, whatever was saved", () => {
    // The owner's choice, left on a tablet a cashier then signs in to under
    // the same key — which cannot happen (the key carries the person), and
    // would not matter if it did.
    const mine: SimpleChoice = { add: ["/tenant/reports", "/tenant/staff", "/tenant/settings"], drop: [] };
    const cashier = pathsOf(simple("mart", mine, false, holding("sales.manage")));

    for (const shut of ["/tenant/reports", "/tenant/staff", "/tenant/settings"]) expect(cashier, shut).not.toContain(shut);
    expect(cashier).toContain("/tenant/pos");
  });

  it("a cashier's Simple view is the counter — by permission, with nothing chosen", () => {
    const cashier = simple("mart", NO_CHOICE, false, holding("sales.manage")).map((i) => i.name);

    expect(cashier).toEqual(expect.arrayContaining(["Dashboard", "POS", "Sales", "Day & banking", "Help Centre"]));
    for (const shut of ["Products", "Inventory", "Expense Manager", "Settings"]) expect(cashier, shut).not.toContain(shut);
  });
});

describe("a choice is kept as differences, so the menu can still move", () => {
  it("a module bought later reaches somebody who had already changed their menu", () => {
    // They moved one row, months ago…
    const mine: SimpleChoice = { add: ["/tenant/reports"], drop: [] };
    const before = { ...FEATURES.mart, delivery: false, marketplace: false };
    const after = { ...before, delivery: true };

    const was = pathsOf(shopNav(before, "mart", "basic", false, OWNER, mine));
    const now = pathsOf(shopNav(after, "mart", "basic", false, OWNER, mine));

    expect(was).not.toContain("/tenant/riders");
    // …and the shop then bought Delivery. Its daily screens arrive anyway.
    expect(now).toContain("/tenant/riders");
    expect(now).toContain("/tenant/orders");
    expect(now).toContain("/tenant/reports");
  });

  it("only real differences count as a choice of one's own", () => {
    const mart = full("mart");

    expect(isOwnChoice(mart, NO_CHOICE)).toBe(false);
    // A leftover about a screen this shop no longer has is not a choice.
    expect(isOwnChoice(mart, { add: ["/tenant/fuel"], drop: [] })).toBe(false);
    expect(isOwnChoice(mart, { add: ["/tenant/reports"], drop: [] })).toBe(true);
  });
});

describe("the arithmetic", () => {
  const menu = full("mart", true);

  it("the usual screens are all screens the menu has", () => {
    const all = new Set(pathsOf(menu));

    expect(usualPaths(menu).length).toBeGreaterThan(5);
    for (const path of usualPaths(menu)) expect(all).toContain(path);
  });

  it("with nothing chosen, Simple is exactly the usual screens", () => {
    expect([...simplePaths(menu)].sort()).toEqual([...new Set(usualPaths(menu))].sort());
  });

  it("keepOnly drops a group with its last screen, and never a screen that was kept", () => {
    const kept = keepOnly(menu, new Set(["/tenant", "/tenant/suppliers"]));

    expect(pathsOf(kept)).toEqual(["/tenant", "/tenant/suppliers"]);
    expect(kept.map((i) => i.name)).toEqual(["Dashboard", "Purchases"]);
  });

  it("tidy leaves a real group alone", () => {
    const groups = tidy(menu).filter((i) => i.subItems !== undefined);

    expect(groups.length).toBeGreaterThan(3);
    for (const g of groups) expect(g.subItems!.length, g.name).toBeGreaterThan(1);
  });

  it("whatever a device was holding reads as a choice", () => {
    expect(asChoice(null)).toEqual(NO_CHOICE);
    expect(asChoice("basic")).toEqual(NO_CHOICE);
    expect(asChoice({ add: "everything" })).toEqual(NO_CHOICE);
    expect(asChoice({ add: ["/tenant/reports", 7, "/tenant/reports", "https://elsewhere.example"], drop: [null, "/tenant/sales"] }))
      .toEqual({ add: ["/tenant/reports"], drop: ["/tenant/sales"] });
  });
});
