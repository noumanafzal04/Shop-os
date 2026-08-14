import type { CatalogItem } from "./catalogService";

/**
 * Every code a scanner can hit, pointing at what to put in the cart.
 *
 * DERIVED from the catalog rather than synced on its own. A second server-fed
 * projection would give a scanner two sources of truth that can disagree, and
 * the disagreement would surface as "this barcode used to work".
 *
 * The shapes it has to cover are the same ones the online lookup already
 * resolves — a code that works at an online till and not at an offline one is a
 * worse bug than no offline at all, because the cashier has no idea why:
 *
 *   · the product's own barcode          · the product's SKU
 *   · its PLU code (a scale's label)     · any alternate barcode
 *   · a VARIANT's SKU                    · a PACK's barcode (strip, box, carton)
 *
 * Variant and pack codes carry which one was scanned, so a carton's barcode
 * lands a carton on the line rather than a single piece at a carton's price.
 */
export interface BarcodeEntry {
  /** The code itself — this store's key. */
  code: string;
  productId: string;
  /** Set when the code belongs to one specific variant. */
  variantId?: string;
  /** Set when the code belongs to a pack size rather than the base unit. */
  unitId?: string;
}

/**
 * Every index entry for one product.
 *
 * Codes are de-duplicated within a product: a shop that typed the same number
 * as both the primary barcode and an alternate would otherwise write two rows
 * on one key, and only the last would survive — silently, and possibly the one
 * pointing at the wrong variant.
 */
export function indexEntriesFor(item: CatalogItem): BarcodeEntry[] {
  const byCode = new Map<string, BarcodeEntry>();

  const add = (code: string | null | undefined, extra: Partial<BarcodeEntry> = {}): void => {
    const trimmed = (code ?? "").trim();
    if (trimmed === "") return;
    // First writer wins: the product's own barcode outranks an alternate that
    // happens to repeat it, and a base-unit code outranks a pack that repeats
    // it. Scanning must land on the plainest reading of the number.
    if (byCode.has(trimmed)) return;
    byCode.set(trimmed, { code: trimmed, productId: item.id, ...extra });
  };

  add(item.barcode);
  add(item.sku);
  // A scale prints the PLU inside a longer label; the parser hands back the
  // PLU, so it has to resolve like any other code.
  add(item.plu_code);

  for (const code of item.barcodes) add(code);
  for (const variant of item.variants) add(variant.sku, { variantId: variant.id });
  for (const unit of item.units) add(unit.barcode, { unitId: unit.id });

  return [...byCode.values()];
}
