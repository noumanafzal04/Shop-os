import { describe, expect, it } from "vitest";

import { asProduct, shelfRows, type Shelf } from "./browse";
import type { CatalogCategory, CatalogItem } from "../sync/catalogService";

/**
 * Browsing the till's own catalog when there is no line.
 *
 * ── What was wrong ──────────────────────────────────────────────────────
 *
 * The till pulled the whole catalog and every category into IndexedDB, and a
 * pure, tested search was written over it — and **nothing ever called it.** The
 * POS pane read a plain HTTP query with no fallback, so the moment the line
 * dropped the pane went empty and the only way to add anything was to scan a
 * barcode.
 *
 * For a mart that is a bad afternoon: most things scan. **For a kitchen it is
 * the whole feature gone** — a dish has no barcode. And it would never have
 * surfaced in the shadow run, because a sale that cannot be started produces no
 * variance to look at.
 */

const item = (over: Partial<CatalogItem> = {}): CatalogItem =>
  ({
    id: "p1",
    name: "Chicken Karahi",
    sku: null,
    barcode: null,
    plu_code: null,
    category_id: "c1",
    item_type: "food_item",
    unit: null,
    sold_by: "unit",
    price: 1200,
    discount_price: null,
    wholesale_price: null,
    price_tiers: null,
    min_order_qty: null,
    tax_rate: null,
    tax_group_id: null,
    track_inventory: false,
    stock: 0,
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

const category = (id: string, name: string, sort = 0): CatalogCategory => ({
  id,
  name,
  parent_id: null,
  sort_order: sort,
});

const shelf = (items: CatalogItem[], categories: CatalogCategory[] = []): Shelf => ({
  items,
  categories,
  categoryNames: new Map(categories.map((c) => [c.id, c.name.toLowerCase()])),
});

const names = (rows: ReturnType<typeof shelfRows>) => rows.map((r) => r.name);

describe("a kitchen with no barcodes", () => {
  it("can still see its menu", () => {
    // The assertion this whole file exists for. A dish has no barcode, so an
    // empty pane offline means a restaurant can ring nothing at all.
    const rows = shelfRows(shelf([item(), item({ id: "p2", name: "Daal Chawal" })]), "", "");

    expect(names(rows)).toEqual(["Chicken Karahi", "Daal Chawal"]);
  });

  it("can filter by category, which is how a menu is read", () => {
    const rows = shelfRows(
      shelf(
        [item(), item({ id: "p2", name: "Cold Drink", category_id: "c2" })],
        [category("c1", "Mains"), category("c2", "Drinks")],
      ),
      "",
      "c2",
    );

    expect(names(rows)).toEqual(["Cold Drink"]);
  });

  it("finds things by their category name, since that is what a cashier types", () => {
    // The reason `categoryIndex` exists — and it had no caller at all until
    // the pane started reading the cache.
    const rows = shelfRows(
      shelf(
        [item(), item({ id: "p2", name: "Cold Drink", category_id: "c2" })],
        [category("c1", "Mains"), category("c2", "Drinks")],
      ),
      "drink",
      "",
    );

    expect(names(rows)).toContain("Cold Drink");
  });

  it("can search by name", () => {
    const rows = shelfRows(shelf([item(), item({ id: "p2", name: "Daal Chawal" })]), "daal", "");

    expect(names(rows)).toEqual(["Daal Chawal"]);
  });
});

describe("the shelf before anything is typed", () => {
  it("is ordered by name, so it does not arrive in insertion order", () => {
    const rows = shelfRows(
      shelf([item({ id: "z", name: "Zinger" }), item({ id: "a", name: "Anda Paratha" })]),
      "",
      "",
    );

    expect(names(rows)).toEqual(["Anda Paratha", "Zinger"]);
  });

  it("is capped — a pane is not a place anybody reads four thousand rows", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      item({ id: `p${i}`, name: `Item ${String(i).padStart(3, "0")}` }),
    );

    expect(shelfRows(shelf(many), "", "", 200)).toHaveLength(200);
  });

  it("is empty, not broken, before the cache has been read", () => {
    // The first render happens before IndexedDB answers. An undefined shelf is
    // a pane that has not loaded, never a crash.
    expect(shelfRows(undefined, "", "")).toEqual([]);
  });
});

describe("what the cached row honestly is", () => {
  it("keeps a sold-out dish marked, so the till refuses it as it would online", () => {
    // Sent rather than filtered out: a till holding yesterday's copy of the
    // menu must learn the dish is off, not go on selling it.
    expect(asProduct(item({ sold_out: true })).sold_out).toBe(true);
  });

  it("derives the coarse type the POS asks stock questions with", () => {
    expect(asProduct(item({ item_type: "service" })).type).toBe("service");
    expect(asProduct(item({ item_type: "food_item" })).type).toBe("product");
  });

  it("carries no images rather than inventing any", () => {
    // Photos are not shipped to the device — the wrong trade. The tile already
    // knows how to draw an item with no picture, and pretending otherwise
    // would be a broken image on a counter screen.
    expect(asProduct(item()).images).toEqual([]);
  });

  it("carries the stock figure the till holds", () => {
    expect(asProduct(item({ track_inventory: true, stock: 7 })).stock_quantity).toBe(7);
  });
});
