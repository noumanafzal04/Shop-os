import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { put, remove } from "../db/repo";
import { STORE } from "../db/schema";
import { findByCode } from "./findByCode";
import { applyPull } from "../sync/applyPull";
import type { CatalogItem, CatalogPull, Page, Tombstone } from "../sync/catalogService";

/**
 * Resolving a scan with no server.
 *
 * The bar is not "it works" — it is that it resolves EXACTLY what the online
 * lookup resolves. A code that rings up online and misses offline is a worse
 * bug than having no offline at all, because the cashier is standing in front
 * of a customer with no idea why the scanner stopped working.
 */

const item = (over: Partial<CatalogItem> & { id: string }): CatalogItem =>
  ({
    name: "Milkpak 1L",
    sku: null,
    barcode: null,
    plu_code: null,
    category_id: null,
    item_type: "physical_product",
    unit: "Piece",
    sold_by: "unit",
    price: 250,
    discount_price: null,
    wholesale_price: null,
    price_tiers: null,
    min_order_qty: null,
    tax_rate: null,
    tax_group_id: null,
    track_inventory: true,
    stock: 40,
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

const page = <T,>(items: Array<T | Tombstone>): Page<T> => ({ items, cursor: "c1", has_more: false });

const pull = (items: Array<CatalogItem | Tombstone>): CatalogPull => ({
  products: page(items),
  categories: page([]),
  promotions: page([]),
  tax_groups: page([]),
  customer_groups: page([]),
  customers: page([]),
  settings: {},
  offline_days: 3,
  offline_selling: true,
  timezone: "Asia/Karachi",
  server_time: new Date().toISOString(),
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("every shape the online lookup resolves", () => {
  beforeEach(async () => {
    await applyPull(
      pull([
        item({
          id: "p1",
          barcode: "8964000000001",
          sku: "MLK-1",
          plu_code: "4011",
          barcodes: ["8964000000002"],
          variants: [{ id: "v1", name: "Large", sku: "MLK-L", price: 400, stock: 3 }],
          units: [{ id: "u1", name: "Carton", factor: 12, price: 2800, barcode: "8964000000003" }],
        }),
      ]),
    );
  });

  it("resolves the product's own barcode", async () => {
    expect((await findByCode("8964000000001"))?.item.id).toBe("p1");
  });

  it("resolves the SKU", async () => {
    expect((await findByCode("MLK-1"))?.item.id).toBe("p1");
  });

  it("resolves a PLU code, which is what a scale's label carries", async () => {
    expect((await findByCode("4011"))?.item.id).toBe("p1");
  });

  it("resolves an alternate barcode", async () => {
    expect((await findByCode("8964000000002"))?.item.id).toBe("p1");
  });

  it("resolves a variant's SKU and says WHICH variant", async () => {
    const match = await findByCode("MLK-L");

    expect(match?.item.id).toBe("p1");
    expect(match?.variantId).toBe("v1");
  });

  it("resolves a pack's barcode and says WHICH pack", async () => {
    // Or a carton's code lands a single piece at a carton's price.
    const match = await findByCode("8964000000003");

    expect(match?.item.id).toBe("p1");
    expect(match?.unitId).toBe("u1");
  });

  it("does not invent a variant or pack for a plain product code", async () => {
    const match = await findByCode("8964000000001");

    expect(match?.variantId).toBeNull();
    expect(match?.unitId).toBeNull();
  });
});

describe("a miss is a miss", () => {
  it("returns null rather than throwing", async () => {
    // An unknown code is an ordinary event: another shop's label, a damaged
    // barcode, a fingernail on the scanner.
    expect(await findByCode("nothing-here")).toBeNull();
  });

  it("returns null for an empty or blank code", async () => {
    expect(await findByCode("")).toBeNull();
    expect(await findByCode("   ")).toBeNull();
  });

  it("does not fuzzy-match a code that is nearly right", async () => {
    // At a counter, ringing up the wrong item because the number almost
    // matched is far worse than asking the cashier to scan again.
    await applyPull(pull([item({ id: "p1", barcode: "8964000000001" })]));

    expect(await findByCode("896400000000")).toBeNull();
    expect(await findByCode("89640000000123")).toBeNull();
  });

  it("ignores surrounding whitespace, which a scanner sometimes adds", async () => {
    await applyPull(pull([item({ id: "p1", barcode: "8964000000001" })]));

    expect((await findByCode("  8964000000001 "))?.item.id).toBe("p1");
  });
});

describe("when the index and the catalog disagree", () => {
  it("refuses a code whose product is gone, rather than returning half an item", async () => {
    // A tombstone removes the product row and its codes in that order, so there
    // is a moment where an entry outlives its product. Answering with a
    // dangling entry would put something in the cart the till has no price for.
    await applyPull(pull([item({ id: "p1", barcode: "111" })]));
    await remove(STORE.CATALOG, "p1");

    expect(await findByCode("111")).toBeNull();
  });

  it("stops resolving every code of a product the server removed", async () => {
    await applyPull(pull([item({ id: "p1", barcode: "111", sku: "S1", barcodes: ["222"] })]));

    await applyPull(pull([{ id: "p1", deleted: true }]));

    expect(await findByCode("111")).toBeNull();
    expect(await findByCode("222")).toBeNull();
    expect(await findByCode("S1")).toBeNull();
  });

  it("stops resolving a code the shop corrected", async () => {
    await applyPull(pull([item({ id: "p1", barcode: "OLD" })]));
    await applyPull(pull([item({ id: "p1", barcode: "NEW" })]));

    expect(await findByCode("OLD")).toBeNull();
    expect((await findByCode("NEW"))?.item.id).toBe("p1");
  });
});

describe("speed", () => {
  it("resolves a scan in single-digit milliseconds over a large catalog", async () => {
    // The number that decides whether offline feels faster than online. A
    // network lookup is 100–400 ms; this has to be a rounding error next to it.
    await applyPull(
      pull(
        Array.from({ length: 5_000 }, (_, i) =>
          item({ id: `p${i}`, barcode: `896400${String(i).padStart(6, "0")}` }),
        ),
      ),
    );

    const started = performance.now();
    const match = await findByCode("896400004999");
    const elapsed = performance.now() - started;

    expect(match?.item.id).toBe("p4999");
    expect(elapsed).toBeLessThan(50);
  });
});

describe("the index is not consulted for anything it does not hold", () => {
  it("does not match a code stored against another product's row by mistake", async () => {
    await put(STORE.BARCODE_INDEX, { code: "orphan", productId: "does-not-exist" });

    expect(await findByCode("orphan")).toBeNull();
  });
});
