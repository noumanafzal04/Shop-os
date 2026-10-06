import { describe, expect, it } from "vitest";

import { shopNav } from "./AppSidebar";
import { TRADE_FEATURES as FEATURES } from "../test/tradeFeatures";

/**
 * THE SHOP'S MENU IS THREE PARTS, AND EACH IS IN ONE PIECE.
 *
 * The rail was one unbroken column — sixteen rows in Full view with nothing
 * to say where "what I do all day" ends and "what I set up once" begins. It
 * is headed now: Daily work, Manage, Your shop.
 *
 * A heading is drawn wherever the section CHANGES from one row to the next.
 * So a row filed under the wrong part, in the middle of another, does not
 * merely sit in the wrong place: it prints a second "Daily work" halfway down
 * the menu. What is held here is that it cannot.
 */

type Mode = "basic" | "advanced";

const ORDER = ["Daily work", "Manage", "Your shop"];

const sections = (type: string, mode: Mode, multiBranch: boolean) =>
  shopNav(FEATURES[type], type, mode, multiBranch, () => true).map((item) => ({
    name: item.name,
    section: item.section,
  }));

/** The headings the rail would actually print, top to bottom. */
const printed = (rows: Array<{ section?: string }>) =>
  rows.map((r) => r.section).filter((s, i, all) => s !== all[i - 1]);

describe("every row belongs to a part of the rail", () => {
  for (const type of Object.keys(FEATURES)) {
    for (const mode of ["basic", "advanced"] as const) {
      for (const multiBranch of [false, true]) {
        it(`${type} / ${mode}${multiBranch ? " / branches" : ""}`, () => {
          const rows = sections(type, mode, multiBranch);

          // The denominator: a menu with nothing on it has nothing misfiled.
          expect(rows.length).toBeGreaterThan(2);

          const unfiled = rows.filter((r) => !r.section).map((r) => r.name);
          expect(unfiled, `no heading for: ${unfiled.join(", ")}`).toEqual([]);

          // Each heading printed once, and in the order a day uses them.
          const heads = printed(rows);
          expect(new Set(heads).size, `a part of the rail is split in two: ${heads.join(" → ")}`).toBe(heads.length);
          expect(heads).toEqual(ORDER.filter((s) => heads.includes(s)));
        });
      }
    }
  }
});

describe("what goes where", () => {
  const part = (type: string, mode: Mode, name: string) =>
    sections(type, mode, true).find((r) => r.name === name)?.section;

  it("the till, the floor and the pass are daily work", () => {
    for (const name of ["Dashboard", "POS", "Dine-in", "Kitchen", "Sales", "Day & banking"]) {
      expect(part("food", "advanced", name), name).toBe("Daily work");
    }
  });

  it("a forecourt is daily work in both views — a station's day IS its shifts", () => {
    expect(part("petroleum", "basic", "Forecourt")).toBe("Daily work");
    expect(part("petroleum", "advanced", "Forecourt")).toBe("Daily work");
  });

  it("the books, the stock and the branches are managed", () => {
    for (const name of ["Expense Manager", "Branches", "Catalog", "Inventory", "More"]) {
      expect(part("mart", "advanced", name), name).toBe("Manage");
    }
    expect(part("mart", "basic", "Products")).toBe("Manage");
  });

  it("settings and help close the rail", () => {
    for (const mode of ["basic", "advanced"] as const) {
      expect(part("mart", mode, "Settings")).toBe("Your shop");
      expect(part("mart", mode, "Help Centre")).toBe("Your shop");
    }
  });
});
