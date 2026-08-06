import { describe, expect, it } from "vitest";

import { reportTabs } from "./reportTabs";

/**
 * Which reports a business can actually fill.
 *
 * A Finance Manager tenant — the books-only type, sold standalone — was being
 * offered seven tabs on the headline screen of the one module it bought, five
 * of which could never contain a single row: Margins and Staff and Tax need
 * sales it does not make, Purchases needs a stock module it does not have,
 * Receipts needs a till it was explicitly sold without. Every month, for
 * years, five empty tables.
 *
 * A report a business can never fill is not a report, which is the same rule
 * the sidebar and the dashboard already follow.
 */

const FINANCE = { pos: false, marketplace: false, dine_in: false, inventory: false };
const MART = { pos: true, marketplace: true, dine_in: false, inventory: true };
const RESTAURANT = { pos: true, marketplace: true, dine_in: true, inventory: false };
const SERVICES = { pos: true, marketplace: false, dine_in: false, inventory: false };

const keys = (features: Record<string, boolean>) => reportTabs(features).map(([key]) => key);

describe("a books-only shop is offered only the report it can fill", () => {
  it("keeps the overview and nothing built out of sales or shelves", () => {
    expect(keys(FINANCE)).toEqual(["overview"]);
  });

  it("names none of the five that would sit empty forever", () => {
    for (const dead of ["margins", "staff", "tax", "receipts", "purchases"]) {
      expect(keys(FINANCE)).not.toContain(dead);
    }
  });
});

describe("everyone else keeps what their modules feed", () => {
  it("a mart gets the lot", () => {
    expect(keys(MART)).toEqual([
      "overview", "margins", "valuation", "dead-stock", "purchases", "staff", "tax", "receipts",
    ]);
  });

  it("a restaurant sells but counts no shelves", () => {
    const tabs = keys(RESTAURANT);

    expect(tabs).toContain("margins");
    expect(tabs).toContain("tax");
    // Food defaults to no inventory module: no valuation, no dead stock, and
    // no purchase orders either — a kitchen with no shelves raises none.
    expect(tabs).not.toContain("valuation");
    expect(tabs).not.toContain("purchases");
  });

  it("a services shop bills labour, so its sales reports stay", () => {
    const tabs = keys(SERVICES);

    expect(tabs).toContain("margins");
    expect(tabs).toContain("staff");
    expect(tabs).not.toContain("valuation");
  });
});

describe("a tab always leads to a report that exists", () => {
  it("holds for every module combination", () => {
    // Brute force over the four flags that decide the answer — 16 shops,
    // and none of them may be offered a tab its modules do not feed.
    for (const pos of [true, false]) {
      for (const marketplace of [true, false]) {
        for (const dine_in of [true, false]) {
          for (const inventory of [true, false]) {
            const features = { pos, marketplace, dine_in, inventory };
            const tabs = keys(features);
            const sells = pos || marketplace || dine_in;

            expect(tabs[0], JSON.stringify(features)).toBe("overview");

            if (!sells) {
              for (const t of ["margins", "staff", "tax", "receipts"]) {
                expect(tabs, JSON.stringify(features)).not.toContain(t);
              }
            }
            if (!inventory) {
              for (const t of ["valuation", "dead-stock", "purchases"]) {
                expect(tabs, JSON.stringify(features)).not.toContain(t);
              }
            }
          }
        }
      }
    }
  });
});
