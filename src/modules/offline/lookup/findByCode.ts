import { get } from "../db/repo";
import { STORE } from "../db/schema";
import type { BarcodeEntry } from "../sync/barcodeIndex";
import type { CatalogItem } from "../sync/catalogService";

/**
 * Resolving a scan against the till's own database.
 *
 * The shape mirrors what the online lookup returns, so the cart-building code
 * upstream cannot tell which one answered — a divergence here would show up as
 * a line priced differently depending on whether the shop had a connection.
 */
export interface CodeMatch {
  item: CatalogItem;
  /** Set when the code named one specific variant. */
  variantId: string | null;
  /** Set when the code named a pack size rather than the base unit. */
  unitId: string | null;
  /** Weight read out of a scale's label, when that is what was scanned. */
  quantity: number | null;
}

/**
 * Find what a scanned or typed code refers to.
 *
 * Two lookups, in this order:
 *
 *   1. The exact code, which covers barcodes, SKUs, PLUs, alternates, variant
 *      SKUs and pack barcodes — every shape the index was built from.
 *   2. Nothing else. A code that misses is a miss, not a fuzzy match: at a
 *      counter, ringing up the wrong item because the number nearly matched is
 *      far worse than telling the cashier to try again.
 *
 * Returns null rather than throwing. A miss is an ordinary event — a code from
 * another shop, a damaged label, a fingernail on the scanner.
 */
export async function findByCode(code: string): Promise<CodeMatch | null> {
  const trimmed = code.trim();
  if (trimmed === "") return null;

  const entry = await get<BarcodeEntry>(STORE.BARCODE_INDEX, trimmed);
  if (entry === undefined) return null;

  const item = await get<CatalogItem>(STORE.CATALOG, entry.productId);
  // The index can outlive its product for a moment — a tombstone removes the
  // product row and its codes in that order. Answering with a dangling entry
  // would put an item in the cart that the till no longer has a price for.
  if (item === undefined) return null;

  return {
    item,
    variantId: entry.variantId ?? null,
    unitId: entry.unitId ?? null,
    quantity: null,
  };
}
