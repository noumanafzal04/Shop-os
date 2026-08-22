import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { count, get, getAll, getSingleton, put } from "../db/repo";
import { STORE } from "../db/schema";
import { applyPull, readMeta, resetCatalog, type SyncMeta } from "./applyPull";
import type { BarcodeEntry } from "./barcodeIndex";
import type { CatalogItem, CatalogPull, Page, Tombstone } from "./catalogService";

/**
 * Writing what the server sent into the till's database.
 *
 * The property this file exists to protect: the cursors are persisted ONLY
 * after every row write has succeeded. Fail partway and nothing moves, so the
 * same pages are fetched again — which costs a request and changes nothing,
 * because every write is an upsert. Persist them any earlier and a failure
 * loses those rows FOR GOOD: the till resumes past changes it never received,
 * nothing asks for them again, and there is no error, no retry and no way to
 * notice.
 *
 * The second is that the barcode index is DERIVED. A code corrected on the
 * server has to stop resolving on the till, or scanning a retired number rings
 * up an item the shop believes it no longer carries under it.
 */

const item = (over: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "p1",
  name: "Milkpak 1L",
  sku: "MLK-1",
  barcode: "8964000000001",
  plu_code: null,
  category_id: "c1",
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
});

const page = <T,>(items: Array<T | Tombstone>, cursor: string | null = "c1"): Page<T> => ({
  items,
  cursor,
  has_more: false,
});

const pull = (over: Partial<CatalogPull> = {}): CatalogPull => ({
  products: page<CatalogItem>([]),
  categories: page([]),
  promotions: page([]),
  tax_groups: page([]),
  customer_groups: page([]),
  customers: page([]),
  settings: { default_tax_rate: 17 },
  offline_days: 3,
  offline_selling: true,
  offline_hard_stop_days: null,
  timezone: "Asia/Karachi",
  server_time: new Date().toISOString(),
  ...over,
});

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("applying a page", () => {
  it("stores each projection in its own place", async () => {
    await applyPull(
      pull({
        products: page([item()]),
        categories: page([{ id: "c1", name: "Grocery", parent_id: null, sort_order: 0 }]),
        promotions: page([{ id: "pr1", name: "Ramzan", type: "percent", value: 10 } as never]),
        tax_groups: page([{ id: "t1", name: "Standard", rate: 17 }]),
        customer_groups: page([{ id: "g1", name: "Trade", price_level: "wholesale", discount_percent: 5 }]),
        customers: page([{ id: "cu1", name: "Ahmed", phone: "0300", customer_group_id: "g1" }]),
      }),
    );

    expect(await count(STORE.CATALOG)).toBe(1);
    expect(await count(STORE.CATEGORIES)).toBe(1);
    expect(await count(STORE.PROMOTIONS)).toBe(1);
    expect(await count(STORE.TAX_CONFIG)).toBe(1);
    expect(await count(STORE.CUSTOMER_GROUPS)).toBe(1);
    expect(await count(STORE.CUSTOMERS)).toBe(1);
  });

  it("upserts, so applying the same page twice lands where applying it once does", async () => {
    // This is what makes re-pulling after a crash free rather than dangerous.
    const p = pull({ products: page([item()]) });

    await applyPull(p);
    await applyPull(p);

    expect(await count(STORE.CATALOG)).toBe(1);
  });

  it("overwrites a row when the server sends a newer one", async () => {
    await applyPull(pull({ products: page([item({ price: 250 })]) }));
    await applyPull(pull({ products: page([item({ price: 300 })]) }));

    expect((await get<CatalogItem>(STORE.CATALOG, "p1"))?.price).toBe(300);
  });

  it("removes what the server tombstoned", async () => {
    await applyPull(pull({ products: page([item()]) }));
    expect(await count(STORE.CATALOG)).toBe(1);

    await applyPull(pull({ products: page<CatalogItem>([{ id: "p1", deleted: true }]) }));

    expect(await count(STORE.CATALOG)).toBe(0);
  });

  it("reports what landed and whether more waits", async () => {
    const result = await applyPull(
      pull({
        products: { items: [item()], cursor: "c9", has_more: true },
        categories: page([{ id: "c1", name: "Grocery", parent_id: null, sort_order: 0 }]),
      }),
    );

    expect(result.applied.products).toBe(1);
    expect(result.applied.customers).toBe(0);
    expect(result.hasMore).toBe(true);
  });
});

describe("the cursor", () => {
  it("is recorded per projection, not shared", async () => {
    await applyPull(
      pull({
        products: page([item()], "prod-cursor"),
        categories: page([], "cat-cursor"),
      }),
    );

    const meta = await readMeta();
    expect(meta.cursors.products).toBe("prod-cursor");
    expect(meta.cursors.categories).toBe("cat-cursor");
  });

  it("does NOT move when a row write fails", async () => {
    // The invariant the whole file is built on. A row with no id cannot be
    // stored, so the write rejects; if the cursor had already been persisted,
    // the till would resume past a page it never received and nothing would
    // ever ask for it again.
    await expect(
      applyPull(
        pull({
          products: page([{ name: "no id at all" } as unknown as CatalogItem], "must-not-land"),
        }),
      ),
    ).rejects.toThrow();

    expect((await readMeta()).cursors.products).toBeUndefined();
  });

  it("does not move for EARLIER projections when a LATER one fails", async () => {
    // Categories are applied before customers. If customers throws, the
    // categories cursor must stay put too — re-fetching them is free, and a
    // half-advanced set of cursors is not recoverable from.
    await expect(
      applyPull(
        pull({
          categories: page([{ id: "c1", name: "Grocery", parent_id: null, sort_order: 0 }], "cat-cursor"),
          customers: page([{ name: "no id" } as never], "cust-cursor"),
        }),
      ),
    ).rejects.toThrow();

    const meta = await readMeta();
    expect(meta.cursors.categories).toBeUndefined();
    expect(meta.cursors.customers).toBeUndefined();
  });

  it("repeating a page is free, which is what makes the retry safe", async () => {
    const p = pull({ products: page([item()], "prod-cursor") });

    await applyPull(p);
    await applyPull(p);

    expect(await count(STORE.CATALOG)).toBe(1);
    expect((await readMeta()).cursors.products).toBe("prod-cursor");
  });

  it("records the server's clock so the till can measure its own drift", async () => {
    // A tablet three days slow would run a promotion that ended and stamp its
    // takings into the wrong trading day.
    const serverTime = new Date(Date.now() + 90_000).toISOString();

    await applyPull(pull({ server_time: serverTime }));

    const meta = await readMeta();
    expect(meta.clockSkewMs).toBeGreaterThan(80_000);
    expect(meta.lastPullAt).toBe(serverTime);
  });
});

describe("settings", () => {
  it("are replaced whole, never merged", async () => {
    // They are sent complete every time and have no id to page by, so a merge
    // would leave a setting the shop REMOVED in place for ever.
    await applyPull(pull({ settings: { default_tax_rate: 17, max_discount_percent: 25 } }));
    await applyPull(pull({ settings: { default_tax_rate: 18 } }));

    const settings = await getSingleton<Record<string, unknown>>(STORE.SETTINGS);
    expect(settings?.default_tax_rate).toBe(18);
    expect(settings?.max_discount_percent).toBeUndefined();
  });

  it("carry the shop's offline window alongside them", async () => {
    await applyPull(pull({ offline_days: 7 }));

    expect((await getSingleton<{ offline_days: number }>(STORE.SETTINGS))?.offline_days).toBe(7);
  });
});

describe("the barcode index", () => {
  it("indexes every code a scanner can hit", async () => {
    await applyPull(
      pull({
        products: page([
          item({
            barcode: "111",
            sku: "SKU-1",
            plu_code: "4011",
            barcodes: ["222"],
            variants: [{ id: "v1", name: "Large", sku: "SKU-1-L", price: 400, stock: 3, is_active: true }],
            units: [{ id: "u1", name: "Carton", factor: 12, price: 2800, barcode: "333" }],
          }),
        ]),
      }),
    );

    const codes = (await getAll<BarcodeEntry>(STORE.BARCODE_INDEX)).map((e) => e.code).sort();

    // A code that resolves at an online till and not at an offline one is worse
    // than no offline at all — the cashier has no idea why it stopped.
    expect(codes).toEqual(["111", "222", "333", "4011", "SKU-1", "SKU-1-L"]);
  });

  it("remembers which variant or pack a code belonged to", async () => {
    // Or a carton's barcode lands a single piece at a carton's price.
    await applyPull(
      pull({
        products: page([
          item({
            variants: [{ id: "v1", name: "Large", sku: "SKU-L", price: 400, stock: 3, is_active: true }],
            units: [{ id: "u1", name: "Carton", factor: 12, price: 2800, barcode: "333" }],
          }),
        ]),
      }),
    );

    expect(await get<BarcodeEntry>(STORE.BARCODE_INDEX, "SKU-L")).toMatchObject({ variantId: "v1" });
    expect(await get<BarcodeEntry>(STORE.BARCODE_INDEX, "333")).toMatchObject({ unitId: "u1" });
  });

  it("stops resolving a code the shop CORRECTED", async () => {
    // The reason the index is rebuilt rather than merged. Overwriting alone
    // leaves the old number pointing at the product for ever, and scanning it
    // rings up an item the shop believes it no longer carries under it.
    await applyPull(pull({ products: page([item({ barcode: "OLD" })]) }));
    expect(await get(STORE.BARCODE_INDEX, "OLD")).toBeDefined();

    await applyPull(pull({ products: page([item({ barcode: "NEW" })]) }));

    expect(await get(STORE.BARCODE_INDEX, "OLD")).toBeUndefined();
    expect(await get(STORE.BARCODE_INDEX, "NEW")).toBeDefined();
  });

  it("stops resolving every code of a product that was removed", async () => {
    await applyPull(pull({ products: page([item({ barcode: "111", barcodes: ["222"] })]) }));

    await applyPull(pull({ products: page<CatalogItem>([{ id: "p1", deleted: true }]) }));

    expect(await count(STORE.BARCODE_INDEX)).toBe(0);
  });

  it("leaves OTHER products' codes alone when one changes", async () => {
    await applyPull(
      pull({
        products: page([item({ id: "p1", barcode: "111", sku: null }), item({ id: "p2", barcode: "222", sku: null })]),
      }),
    );

    await applyPull(pull({ products: page([item({ id: "p1", barcode: "999", sku: null })]) }));

    expect(await get(STORE.BARCODE_INDEX, "222")).toBeDefined();
    expect(await get(STORE.BARCODE_INDEX, "999")).toBeDefined();
    expect(await get(STORE.BARCODE_INDEX, "111")).toBeUndefined();
  });

  it("does not write two rows when a shop typed one number twice", async () => {
    // Same number as the primary barcode and as an alternate. Two rows on one
    // key means only the last survives — silently, possibly the wrong one.
    await applyPull(pull({ products: page([item({ barcode: "111", barcodes: ["111"], sku: null })]) }));

    expect(await count(STORE.BARCODE_INDEX)).toBe(1);
    expect(await get<BarcodeEntry>(STORE.BARCODE_INDEX, "111")).toMatchObject({ productId: "p1" });
  });
});

describe("starting over", () => {
  it("clears every cache and forgets where it was", async () => {
    await applyPull(pull({ products: page([item()], "somewhere") }));

    await resetCatalog();

    expect(await count(STORE.CATALOG)).toBe(0);
    expect(await count(STORE.BARCODE_INDEX)).toBe(0);
    expect((await readMeta()).cursors.products).toBeUndefined();
  });

  it("does NOT touch the outbox", async () => {
    // Those are sales that already happened. Clearing them is losing money
    // that crossed a counter.
    await put(STORE.OUTBOX, { op: "sale-1", status: "PENDING", createdAt: 1 });
    await applyPull(pull({ products: page([item()]) }));

    await resetCatalog();

    expect(await count(STORE.OUTBOX)).toBe(1);
  });
});

describe("a till upgrading from an older schema", () => {
  it("keeps its unsent sales", async () => {
    // The schema gained three stores at version 2. An upgrade must never touch
    // work that has not reached the server.
    await put(STORE.OUTBOX, { op: "sale-1", status: "PENDING", createdAt: 1 });

    await applyPull(pull({ products: page([item()]) }));

    expect(await count(STORE.OUTBOX)).toBe(1);
    const meta = await getSingleton<SyncMeta>(STORE.SYNC_META);
    expect(meta?.cursors.products).toBe("c1");
  });
});
