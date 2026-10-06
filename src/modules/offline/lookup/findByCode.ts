import { get, getAll, getSingleton } from "../db/repo";
import { STORE } from "../db/schema";
import type { BarcodeEntry } from "../sync/barcodeIndex";
import type { CatalogItem } from "../sync/catalogService";
import { labelQuantity, parseScaleLabel, pluCandidates } from "./scaleLabel";

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
 * In this order:
 *
 *   0. A weighing scale's label, where the shop reads them — see scaleLabel.
 *      `quantity` was on this shape from the start ("weight read out of a
 *      scale's label") and was always null: the field was the plan, and
 *      nothing ever filled it in.
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

  // A SCALE'S LABEL FIRST, exactly as the server asks first. It is not in the
  // index and cannot be: the weight is part of the number, so no two labels
  // for the same sugar are the same thirteen digits.
  const label = parseScaleLabel(trimmed, await getSingleton<Record<string, unknown>>(STORE.SETTINGS).catch(() => undefined));
  if (label !== null) {
    const wanted = pluCandidates(label);
    const weighed = (await getAll<CatalogItem>(STORE.CATALOG)).find(
      (candidate) => candidate.plu_code != null && wanted.includes(String(candidate.plu_code)),
    );
    // A label for something this shop does not stock is a miss — and is NOT
    // then tried as an ordinary barcode, which is the server's answer too.
    if (weighed === undefined) return null;

    return { item: weighed, variantId: null, unitId: null, quantity: labelQuantity(label, weighed) };
  }

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
