import { describe, expect, it } from "vitest";

/**
 * A SCREEN THAT SELLS LISTS ONLY WHAT IS ON SALE.
 *
 * Found by a browser, on a phone, by accident: two products created switched
 * OFF were the first two rows on the till, each with an Add button. The server
 * refuses a retired product at the sale — "An item in this sale is no longer
 * available" — so the till was offering something it would turn down at the
 * last press. The exchange picker and Take Order did the same; the New Sale
 * form hid them itself, after fetching, at the cost of short pages.
 *
 * The products endpoint lists everything unless asked otherwise, which is
 * right for the catalogue (that is where a retired product is switched back
 * on) and wrong for a counter. So each selling screen has to ASK — and a rule
 * each screen must remember is a rule the next screen forgets. This reads the
 * source of every screen that fetches products and holds the selling ones to
 * asking.
 */
const sources = import.meta.glob("../**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Screens whose product list is something to SELL from. */
const SELLS = [
  "../pos/pages/PosPage.tsx",
  "../sales/pages/NewSalePage.tsx",
  "../sales/pages/SalesPage.tsx",
  "../orders/pages/TakeOrderPage.tsx",
  "../documents/components/NewDocumentSheet.tsx",
];

/**
 * Screens that list products for another reason, each with the reason. A new
 * caller of `useProducts` belongs in one list or the other — the test below
 * fails until somebody decides which.
 */
const NOT_SELLING: Record<string, string> = {
  "./pages/ProductsPage.tsx": "the catalogue itself — where a retired product is found and switched back on",
  "./pages/CollectionsPage.tsx": "arranging the catalogue, retired items included",
  "./pages/LabelsPage.tsx": "labels are printed for stock on hand, on sale or not",
  "./pages/ProductFormPage.tsx": "names it only in a comment — its pickers read the whole catalogue through another hook",
  "../inventory/pages/InventoryPage.tsx": "stock is counted and corrected whether or not it is on sale",
  "../inventory/components/WriteOffModal.tsx": "a retired product is exactly what gets written off",
  "../purchases/components/NewPurchaseOrder.tsx": "goods are bought and received before they are put on sale",
};

const calls = (source: string) => [...source.matchAll(/useProducts\(\{([^}]*)\}\)/g)].map((m) => m[1]);

describe("a screen that sells lists only what is on sale", () => {
  it("every selling screen asks for it", () => {
    for (const path of SELLS) {
      const source = sources[path];
      expect(source, `${path} is listed as a selling screen and is not there`).toBeDefined();

      const selling = calls(source).filter((args) => !/tradeIn/.test(args));
      expect(selling.length, `${path} no longer fetches products — take it off the list`).toBeGreaterThan(0);
      // The till's trade-in search is the one exception inside a selling
      // screen: what a customer hands OVER is not something on sale here.
      const forgot = selling.filter((args) => !/for_sale:\s*true/.test(args));
      expect(forgot, `${path} lists products to sell without asking for those on sale`).toEqual([]);
    }
  });

  it("no screen fetches products without somebody having decided which kind it is", () => {
    const undecided = Object.entries(sources)
      .filter(([, source]) => /useProducts\(\{/.test(source))
      .map(([path]) => path)
      .filter((path) => !SELLS.includes(path) && !(path in NOT_SELLING));

    expect(undecided, "add each to SELLS (and ask for_sale) or to NOT_SELLING with the reason").toEqual([]);
  });

  it("names no screen that is not there", () => {
    for (const path of Object.keys(NOT_SELLING)) {
      expect(sources[path], `${path} is excused and no longer exists`).toBeDefined();
    }
  });
});
