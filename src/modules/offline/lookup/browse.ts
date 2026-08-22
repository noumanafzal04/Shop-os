import type { Product as CatalogProduct } from "../../catalog/types";
import { getAll } from "../db/repo";
import { STORE } from "../db/schema";
import type { CatalogCategory, CatalogItem } from "../sync/catalogService";
import { withLocalStock } from "../outbox/localStock";
import { categoryIndex, searchCatalog } from "./search";

/**
 * Browsing the till's own catalog when there is no line.
 *
 * ── The hole this closes ────────────────────────────────────────────────
 *
 * The till pulls the entire catalog and every category into IndexedDB, and a
 * pure, tested offline search was written over it — `searchCatalog`,
 * `categoryIndex`. **Nothing ever called either of them.** The POS product
 * pane reads `useProducts`, a plain HTTP query with no fallback, so the moment
 * the line drops the pane goes empty and the only way to add anything is to
 * scan a barcode.
 *
 * For a mart that is a bad afternoon: most things scan. **For a restaurant it
 * is the whole feature gone** — a dish has no barcode, so an offline kitchen
 * could ring nothing at all. And it would never have shown up in the shadow
 * run, because a sale that cannot be started produces no variance to look at.
 *
 * Ninth time this codebase has built something and left nothing a person
 * touches able to reach it.
 *
 * ── What is honestly missing offline ────────────────────────────────────
 *
 * Images are not cached — shipping every product photo to every tablet is the
 * wrong trade — so tiles fall back to the letter placeholder they already draw
 * for an item with no picture. Brand, generic name and description are not in
 * the projection either; the description is deliberately absent (see
 * `searchCatalog`), and the other two simply are not sent.
 *
 * Nothing here pretends otherwise. A field that is not on the device comes
 * back undefined, and the screen draws exactly what it draws for an item that
 * never had one.
 */

/**
 * The cached row, in the shape the till's own screen renders.
 *
 * `type` is derived rather than stored: the projection carries `item_type`,
 * and the POS asks the coarse question ("does this hold stock?") which is the
 * same question the server derives the same way.
 */
export function asProduct(item: CatalogItem): CatalogProduct {
  return {
    id: item.id,
    name: item.name,
    sku: item.sku,
    barcode: item.barcode,
    plu_code: item.plu_code,
    category_id: item.category_id,
    item_type: item.item_type,
    type: item.item_type === "service" ? "service" : "product",
    unit: item.unit,
    sold_by: item.sold_by,
    price: item.price,
    discount_price: item.discount_price,
    wholesale_price: item.wholesale_price,
    price_tiers: item.price_tiers,
    min_order_qty: item.min_order_qty,
    tax_rate: item.tax_rate,
    tax_group_id: item.tax_group_id,
    track_inventory: item.track_inventory,
    stock_quantity: item.stock,
    low_stock_threshold: item.low_stock_threshold,
    available_from: item.available_from,
    available_until: item.available_until,
    requires_prescription: item.requires_prescription,
    drug_schedule: item.drug_schedule,
    tracks_serial: item.tracks_serial,
    kitchen_station: item.kitchen_station,
    sold_out: item.sold_out ?? false,
    // TRANSLATED, not passed through. The device stores `stock` and no `cost`;
    // the till's `ProductVariant` wants `stock_quantity` and `is_active`. The
    // `as unknown as` cast at the bottom of this function hid that mismatch, so
    // every variant read offline had `stock_quantity: undefined` — which is how
    // a size chip would have rendered its stock as NaN. The product-level fields
    // above have always been renamed properly; the variants were the one thing
    // handed over unconverted.
    variants: item.variants.map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku,
      price: v.price,
      // Not on the device on purpose — see PosProjection.
      cost: null,
      stock_quantity: v.stock,
      low_stock_threshold: null,
      // Older devices synced before the projection carried this. Treating a
      // missing flag as ACTIVE keeps a till that has not re-pulled selling its
      // sizes, which is the safer of the two wrong answers: the server refuses a
      // retired variant regardless, so the worst case is a refusal the shop can
      // see, not a silent one.
      is_active: v.is_active ?? true,
    })),
    units: item.units,
    modifier_groups: item.modifier_groups,
    // Not on the device, and not invented. The tile already knows how to draw
    // an item with no picture.
    images: [],
  } as unknown as CatalogProduct;
}

export interface Shelf {
  items: CatalogItem[];
  categories: CatalogCategory[];
  /** category id → name, built once so search can match on it. */
  categoryNames: Map<string, string>;
}

/**
 * The till's whole shelf, read once.
 *
 * Once, not per keystroke — which is exactly what `searchCatalog` was written
 * for. At twenty thousand items the projection is a few megabytes, and
 * scanning it in memory beats a round trip to IndexedDB on every letter.
 */
export async function loadShelf(): Promise<Shelf> {
  const [raw, categories] = await Promise.all([
    getAll<CatalogItem>(STORE.CATALOG),
    getAll<CatalogCategory>(STORE.CATEGORIES),
  ]);

  // What is ACTUALLY left, not what the server last said.
  //
  // `withLocalStock` had no caller either. Without it the shelf shows the
  // figure from the last pull all evening: a mart shifts forty cartons of milk
  // during load-shedding and the till still reads forty, forty, forty — and
  // the cashier finds out when a customer asks for the forty-first. The
  // deltas are derived from the outbox rather than stored, so they cannot
  // drift from the queue: they ARE the queue.
  const items = await withLocalStock(raw);

  return {
    items,
    // Ordered the way the shop ordered them, so the tabs do not rearrange
    // themselves the moment the line drops.
    categories: [...categories].sort((a, b) => a.sort_order - b.sort_order),
    categoryNames: categoryIndex(categories),
  };
}

/**
 * What the pane shows, given what has been typed.
 *
 * With no search and no category this is the plain shelf ordered by name and
 * capped — a pane is not a place anybody reads four thousand rows.
 */
export function shelfRows(
  shelf: Shelf | undefined,
  search: string,
  categoryId: string,
  limit = 200,
): CatalogProduct[] {
  if (shelf === undefined) return [];

  const inCategory = categoryId
    ? shelf.items.filter((i) => i.category_id === categoryId)
    : shelf.items;

  const needle = search.trim();

  const rows = needle
    ? searchCatalog(inCategory, needle, { categories: shelf.categoryNames, limit })
    : [...inCategory].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);

  return rows.map(asProduct);
}
