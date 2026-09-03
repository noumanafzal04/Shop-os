import { describe, expect, it } from "vitest";

import { REPORT_TABS, reportTabAvailable, reportTabs } from "./reportTabs";

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
 *
 * ── Second pass ─────────────────────────────────────────────────────────
 *
 * When Purchasing and Bank offers became modules of their own, this file's
 * MART fixture — four flags, none of them the new keys — kept passing while
 * both tabs were being offered to shops that had neither. The matrix at the
 * bottom had the same blind spot: it varied `inventory` and never `purchasing`,
 * so it could not have caught it either. Both now carry the keys that decide
 * the answer.
 */

const FINANCE = { pos: false, marketplace: false, dine_in: false, inventory: false };
const MART = {
  pos: true, marketplace: true, dine_in: false, inventory: true,
  purchasing: true, bank_offers: true,
};
const RESTAURANT = { pos: true, marketplace: true, dine_in: true, inventory: false };
const SERVICES = { pos: true, marketplace: false, dine_in: false, inventory: false };

/** Counts its shelves, buys over the counter, keeps no supplier book. */
const CASH_AND_CARRY = { pos: true, inventory: true, purchasing: false, bank_offers: false };

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
      // Offered to every selling shop and not gated on having been offline —
      // load-shedding is universal here, and a tab that appeared only once
      // there was bad news is a tab nobody knows exists.
      "offline",
      "bank-claims",
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

describe("the two tabs that used to ride on somebody else's module", () => {
  it("a shop that counts stock but keeps no supplier book gets no Purchases tab", () => {
    const tabs = keys(CASH_AND_CARRY);

    // It still values and ages its shelves — those ARE the stock module.
    expect(tabs).toContain("valuation");
    expect(tabs).toContain("dead-stock");
    // But a purchase order is the purchasing module, and /tenant/purchases
    // would refuse this shop.
    expect(tabs).not.toContain("purchases");
  });

  it("Bank claims follows the bank-offers module, not merely selling", () => {
    expect(keys(CASH_AND_CARRY)).not.toContain("bank-claims");
    expect(keys({ ...CASH_AND_CARRY, promotions: true, bank_offers: true })).toContain("bank-claims");
  });
});

describe("the tab drawn and the tab allowed are one rule", () => {
  it("agrees with itself for every tab and every shop", () => {
    // The page used to keep its own two arrays for "may this shop still be
    // sitting on that tab", and they drifted from the list that draws them.
    // One table answers both questions now; this is what says so.
    for (const shop of [FINANCE, MART, RESTAURANT, SERVICES, CASH_AND_CARRY]) {
      const offered = keys(shop);

      for (const tab of REPORT_TABS) {
        expect(reportTabAvailable(shop, tab.key), `${tab.key} @ ${JSON.stringify(shop)}`)
          .toBe(offered.includes(tab.key));
      }
    }
  });

  it("refuses a tab it has never heard of, rather than rendering nothing", () => {
    expect(reportTabAvailable(MART, "sales-by-moon-phase")).toBe(false);
  });
});

describe("a tab always leads to a report that exists", () => {
  it("holds for every module combination", () => {
    // Brute force over the SIX flags that decide the answer. It was four, and
    // the two that were missing are exactly the two that were wrong.
    for (const pos of [true, false]) {
      for (const marketplace of [true, false]) {
        for (const dine_in of [true, false]) {
          for (const inventory of [true, false]) {
            for (const purchasing of [true, false]) {
              for (const bank_offers of [true, false]) {
                const features = { pos, marketplace, dine_in, inventory, purchasing, bank_offers };
                const tabs = keys(features);
                const sells = pos || marketplace || dine_in;
                const where = JSON.stringify(features);

                expect(tabs[0], where).toBe("overview");

                if (!sells) {
                  for (const t of ["margins", "staff", "tax", "receipts", "offline"]) {
                    expect(tabs, where).not.toContain(t);
                  }
                }
                if (!inventory) {
                  for (const t of ["valuation", "dead-stock"]) {
                    expect(tabs, where).not.toContain(t);
                  }
                }
                if (!purchasing) expect(tabs, where).not.toContain("purchases");
                if (!bank_offers) expect(tabs, where).not.toContain("bank-claims");
              }
            }
          }
        }
      }
    }
  });
});
