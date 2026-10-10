import { describe, expect, it } from "vitest";

import { findScreens, screensOf } from "./screens";

const NAV = [
  { name: "Dashboard", path: "/tenant" },
  { name: "POS", path: "/tenant/pos" },
  { name: "Sales", path: "/tenant/sales" },
  { name: "Products", path: "/tenant/products" },
  {
    name: "Expense Manager",
    subItems: [
      { name: "Expenses", path: "/tenant/expenses" },
      { name: "Other income", path: "/tenant/income" },
      { name: "Ledger", path: "/tenant/ledger" },
      { name: "Reports", path: "/tenant/reports" },
    ],
  },
  { name: "Inventory", subItems: [{ name: "Stock", path: "/tenant/inventory" }, { name: "Stock counts", path: "/tenant/stocktake" }] },
  // The same screen reachable from two rows is one screen.
  { name: "Shortcuts", subItems: [{ name: "Sales", path: "/tenant/sales" }] },
];

describe("the screens search can jump to", () => {
  const screens = screensOf(NAV);

  it("are the menu's own — rows and the rows under them, once each, in its order", () => {
    expect(screens.map((s) => s.name)).toEqual([
      "Dashboard", "POS", "Sales", "Products", "Expenses", "Other income", "Ledger", "Reports", "Stock", "Stock counts",
    ]);
    expect(screens.find((s) => s.name === "Ledger")).toEqual({ name: "Ledger", path: "/tenant/ledger", under: "Expense Manager" });
    expect(screens.filter((s) => s.path === "/tenant/sales")).toHaveLength(1);
  });

  it("a row that only opens others is not somewhere to go", () => {
    expect(screens.some((s) => s.name === "Expense Manager")).toBe(false);
  });

  it("with nothing typed, offers the head of the menu — where a day starts", () => {
    expect(findScreens(screens, "", 4).map((s) => s.name)).toEqual(["Dashboard", "POS", "Sales", "Products"]);
  });

  it("finds a screen by the start of its name", () => {
    expect(findScreens(screens, "led").map((s) => s.name)).toEqual(["Ledger"]);
    expect(findScreens(screens, "POS")[0].path).toBe("/tenant/pos");
  });

  it("finds one by a word inside its name", () => {
    expect(findScreens(screens, "inc").map((s) => s.name)).toEqual(["Other income"]);
  });

  it("finds everything under a menu row by that row's name", () => {
    // "expense" is how somebody asks for the cashbook's neighbours.
    expect(findScreens(screens, "expense").map((s) => s.name)).toEqual(["Expenses", "Other income", "Ledger", "Reports"]);
  });

  it("puts the name that starts with it ahead of the one that only holds it", () => {
    expect(findScreens(screens, "sto").map((s) => s.name)).toEqual(["Stock", "Stock counts"]);
    expect(findScreens(screens, "s").map((s) => s.name).slice(0, 3)).toEqual(["Sales", "Stock", "Stock counts"]);
  });

  it("offers nothing for a word no screen answers to, and never more than it was asked for", () => {
    expect(findScreens(screens, "payroll")).toEqual([]);
    expect(findScreens(screens, "e", 2)).toHaveLength(2);
  });
});
