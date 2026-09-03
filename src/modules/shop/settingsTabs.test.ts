import { describe, expect, it } from "vitest";

import { posSubTabsFor, settingsTabsFor } from "./settingsTabs";

/**
 * Settings must not offer a tab whose switches do nothing.
 *
 * The whole list used to go straight to `FilterTabs` unfiltered, so a Finance
 * Manager tenant — the books-only type, sold with no till, no catalog and no
 * stock — was handed Point of Sale, Loyalty, Receipt and Barcodes. Every switch
 * on them saved without complaint and changed nothing, on the very first screen
 * a new shop opens. Only the POS SUB-tabs filtered, which is why Kitchen hid
 * itself correctly and the four above it did not.
 */

// `customers` and `labels` are modules of their own now — Loyalty follows the
// customer book (there is nobody to award points to without one) and Barcodes
// follows the labels screen it configures.
const FINANCE = { pos: false, marketplace: false, dine_in: false, products: false, inventory: false, customers: false, labels: false };
const MART = { pos: true, marketplace: true, dine_in: false, products: true, inventory: true, customers: true, labels: true };
const RESTAURANT = { pos: true, marketplace: true, dine_in: true, products: true, inventory: false, customers: true, labels: true };
const ONLINE_ONLY = { pos: false, marketplace: true, dine_in: false, products: true, inventory: true, customers: true, labels: true };

const keys = (features: Record<string, boolean>) => settingsTabsFor(features).map((t) => t.key);

describe("a books-only shop is offered only what it can use", () => {
  it("keeps its name and address and nothing else", () => {
    // "Your modules" is universal — it is the answer to "why can I not see
    // Purchases", and a books-only office asks it as often as anybody.
    expect(keys(FINANCE)).toEqual(["business", "modules"]);
  });

  it("names none of the tabs whose switches would do nothing", () => {
    for (const dead of ["tax", "pos", "loyalty", "receipt", "hardware", "barcode"]) {
      expect(keys(FINANCE)).not.toContain(dead);
    }
  });
});

describe("everyone else keeps what their modules feed", () => {
  it("a mart gets the lot", () => {
    expect(keys(MART)).toEqual([
      "business", "modules", "tax", "pos", "loyalty", "receipt", "hardware", "barcode",
    ]);
  });

  it("a restaurant gets the lot too — dine-in sells, so tax and receipts stay", () => {
    expect(keys(RESTAURANT)).toEqual([
      "business", "modules", "tax", "pos", "loyalty", "receipt", "hardware", "barcode",
    ]);
  });

  it("an online-only shop keeps tax and receipts but loses the counter's kit", () => {
    const tabs = keys(ONLINE_ONLY);

    // It sells — just not across a counter.
    expect(tabs).toContain("tax");
    expect(tabs).toContain("receipt");
    expect(tabs).toContain("loyalty");
    // No till means no till defaults and no receipt printer or cash drawer.
    expect(tabs).not.toContain("pos");
    expect(tabs).not.toContain("hardware");
  });
});

describe("the rules hold for every module combination", () => {
  it("never offers a tab the shop cannot use, and never leaves the shop tab-less", () => {
    // Brute force over the four flags that decide every answer — 16 shops.
    for (const pos of [true, false]) {
      for (const marketplace of [true, false]) {
        for (const dine_in of [true, false]) {
          for (const labels of [true, false]) {
            const features = { pos, marketplace, dine_in, labels };
            const tabs = keys(features);
            const sells = pos || marketplace || dine_in;
            const where = JSON.stringify(features);

            // Business is universal, so there is always somewhere to land —
            // this is also what makes the page's fallback to it safe.
            expect(tabs, where).toContain("business");

            if (!sells) {
              for (const t of ["tax", "loyalty", "receipt"]) {
                expect(tabs, where).not.toContain(t);
              }
            }
            if (!pos) {
              for (const t of ["pos", "hardware"]) {
                expect(tabs, where).not.toContain(t);
              }
            }
            if (!labels) {
              expect(tabs, where).not.toContain("barcode");
            }
          }
        }
      }
    }
  });
});

/**
 * THE TILL'S SECOND ROW, and the tab a takeaway café could not reach.
 *
 * `POS_SUBTABS` used to gate Kitchen on `dine_in`. That was true while the pass
 * only ever existed for a floor — and stopped being true the moment Kitchen
 * became a module of its own, which exists precisely so a café with no tables
 * can have one. Such a shop was handed the kitchen board, told to work off it,
 * and could not name a station or say whether tickets print.
 */
describe("the till's kitchen settings follow the kitchen, not the floor", () => {
  const subKeys = (features: Record<string, boolean>) =>
    posSubTabsFor(features).map((t) => t.key);

  it("a takeaway counter with a pass and no tables gets the Kitchen tab", () => {
    expect(subKeys({ pos: true, kitchen: true, dine_in: false })).toContain("kitchen");
  });

  it("a shop with a floor still gets it — dine-in depends on the pass", () => {
    expect(subKeys({ pos: true, kitchen: true, dine_in: true })).toContain("kitchen");
  });

  it("a mart with no kitchen at all does not", () => {
    expect(subKeys({ pos: true, inventory: true })).not.toContain("kitchen");
  });

  it("leaves the three universal ones alone", () => {
    // If the filter ever ate everything, every assertion above about a missing
    // tab would pass for the wrong reason.
    expect(subKeys({})).toEqual(["till", "registers", "selling"]);
  });
});
