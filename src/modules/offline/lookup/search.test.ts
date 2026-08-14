import { describe, expect, it } from "vitest";

import { categoryIndex, searchCatalog } from "./search";
import type { CatalogItem } from "../sync/catalogService";

/**
 * Typing part of a name at the counter.
 *
 * Ranking is the whole feature. A cashier with a customer waiting looks at the
 * first row and clicks it; a correct result in position nine is a wrong result.
 */

const item = (over: Partial<CatalogItem> & { id: string; name: string }): CatalogItem =>
  ({
    sku: null,
    barcode: null,
    plu_code: null,
    category_id: null,
    item_type: "physical_product",
    unit: null,
    sold_by: "unit",
    price: 100,
    discount_price: null,
    wholesale_price: null,
    price_tiers: null,
    min_order_qty: null,
    tax_rate: null,
    tax_group_id: null,
    track_inventory: true,
    stock: 1,
    low_stock_threshold: null,
    available_from: null,
    available_until: null,
    requires_prescription: false,
    drug_schedule: null,
    tracks_serial: false,
    kitchen_station: null,
    offline_ok: true,
    variants: [],
    units: [],
    barcodes: [],
    modifier_groups: [],
    ...over,
  }) as CatalogItem;

const names = (rows: CatalogItem[]): string[] => rows.map((r) => r.name);

describe("what it matches", () => {
  const catalog = [
    item({ id: "1", name: "Full Cream Milk", sku: "MLK-1", barcode: "8964001" }),
    item({ id: "2", name: "Milkshake Powder", sku: "PWD-9" }),
    item({ id: "3", name: "Tea Bags", sku: "TEA-1", category_id: "c1" }),
  ];

  it("finds by part of the name", () => {
    expect(names(searchCatalog(catalog, "milk"))).toContain("Full Cream Milk");
  });

  it("finds by SKU", () => {
    expect(names(searchCatalog(catalog, "PWD-9"))).toEqual(["Milkshake Powder"]);
  });

  it("finds by barcode", () => {
    expect(names(searchCatalog(catalog, "8964001"))).toEqual(["Full Cream Milk"]);
  });

  it("finds by category name when one is supplied", () => {
    const categories = categoryIndex([{ id: "c1", name: "Beverages", parent_id: null, sort_order: 0 }]);

    expect(names(searchCatalog(catalog, "bever", { categories }))).toEqual(["Tea Bags"]);
  });

  it("ignores case", () => {
    expect(names(searchCatalog(catalog, "FULL CREAM"))).toEqual(["Full Cream Milk"]);
  });

  it("returns nothing for an empty query rather than the whole catalog", () => {
    // A blank box is not a request for 20,000 rows.
    expect(searchCatalog(catalog, "")).toEqual([]);
    expect(searchCatalog(catalog, "   ")).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(searchCatalog(catalog, "bicycle")).toEqual([]);
  });
});

describe("ranking — the first row is the answer", () => {
  it("puts an exact code above any name match", () => {
    // Somebody typed a number. That is not a guess.
    const catalog = [
      item({ id: "1", name: "MLK Special Offer" }),
      item({ id: "2", name: "Butter", sku: "MLK" }),
    ];

    expect(names(searchCatalog(catalog, "MLK"))[0]).toBe("Butter");
  });

  it("puts a name that STARTS with the query above one that merely contains it", () => {
    const catalog = [
      item({ id: "1", name: "Chocolate Milk Shake Powder" }),
      item({ id: "2", name: "Milk 1 Litre" }),
    ];

    expect(names(searchCatalog(catalog, "milk"))).toEqual([
      "Milk 1 Litre",
      "Chocolate Milk Shake Powder",
    ]);
  });

  it("puts a whole word above a match inside a longer word", () => {
    // "milk" should find "Full Cream Milk" ahead of "Milkshake".
    const catalog = [
      item({ id: "1", name: "Zebra Milkshake" }),
      item({ id: "2", name: "Full Cream Milk" }),
    ];

    expect(names(searchCatalog(catalog, "milk"))[0]).toBe("Full Cream Milk");
  });

  it("puts an exact name above a longer one that starts the same", () => {
    const catalog = [
      item({ id: "1", name: "Tea Bags Family Pack" }),
      item({ id: "2", name: "Tea" }),
    ];

    expect(names(searchCatalog(catalog, "tea"))[0]).toBe("Tea");
  });

  it("orders ties by name, so the same query never reshuffles", () => {
    // A list that changes order between keystrokes is one nobody can click.
    const catalog = [
      item({ id: "1", name: "Milk Zeta" }),
      item({ id: "2", name: "Milk Alpha" }),
      item({ id: "3", name: "Milk Beta" }),
    ];

    const first = names(searchCatalog(catalog, "milk"));

    expect(first).toEqual(["Milk Alpha", "Milk Beta", "Milk Zeta"]);
    expect(names(searchCatalog(catalog, "milk"))).toEqual(first);
  });
});

describe("size", () => {
  it("caps how many rows come back", () => {
    const catalog = Array.from({ length: 500 }, (_, i) =>
      item({ id: `p${i}`, name: `Milk ${String(i).padStart(3, "0")}` }),
    );

    expect(searchCatalog(catalog, "milk")).toHaveLength(50);
    expect(searchCatalog(catalog, "milk", { limit: 5 })).toHaveLength(5);
  });

  it("stays fast enough to run on every keystroke over a large catalog", () => {
    // 20,000 items is a big Pakistani mart. If this were slow the counter would
    // feel it on every letter typed, which is the one place lag is unforgivable.
    const catalog = Array.from({ length: 20_000 }, (_, i) =>
      item({ id: `p${i}`, name: `Product ${i}`, sku: `SKU-${i}` }),
    );

    const started = performance.now();
    searchCatalog(catalog, "product 1");
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(150);
  });
});

describe("what it deliberately does not search", () => {
  it("has no description to search, and does not pretend otherwise", () => {
    // Descriptions are the largest column in the table and are left out of the
    // projection entirely — shipping 5,000 characters per item to every tablet
    // to make one rare search work is the wrong trade. The online search does
    // read them; this is a stated difference, not an oversight.
    const catalog = [item({ id: "1", name: "Soap" })];

    expect("description" in catalog[0]).toBe(false);
  });
});
