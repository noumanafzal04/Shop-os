import type { Product, ProductVariant } from "../catalog/types";

/**
 * MAY THIS BE SOLD, AND IN WHICH SIZE?
 *
 * One module because there are now six doors into a cart — a tile, a row, a size
 * chip, a quick key, the barcode scanner and the dine-in tab — and the first
 * draft of this feature answered the question separately in two files inside
 * twenty minutes. That is the exact fault this codebase keeps finding: the 86
 * rule enforced by the till and not the tab, the discount ceiling checked at the
 * counter and not at settle, the prescription fence reading one column at the
 * till and another on an order. Every one of them was one question with more
 * than one implementation, and only some of them right.
 *
 * So the rule lives here and the doors call it.
 *
 * The backend half of the same question is already consistent and already
 * guarded: `VARIANT_UNAVAILABLE` sits in the common set of
 * `scripts/one-rule-many-paths.py`, thrown by the counter, the tab and the order
 * alike. That script reads PHP only, so it can say nothing about this file —
 * which is why the rule is one function here rather than a convention.
 */

/**
 * The sizes a shop may actually sell.
 *
 * `is_active` is filtered here and nowhere else, so no screen has to remember.
 * **Missing means active**, on purpose: a till that synced before the offline
 * projection carried the flag would otherwise show a product with no sizes at
 * all, which looks like a catalogue problem rather than a stale device. The
 * server refuses a retired size regardless, so the worst case is a refusal the
 * shop can see instead of a size that silently vanished.
 */
export function sizesOf(p: { variants?: ProductVariant[] | null }): ProductVariant[] {
  return (p.variants ?? []).filter((v) => v.is_active !== false);
}

/**
 * What the catalogue says is on the shelf for one size, at this branch.
 *
 * `branch_stock` is stamped by the operating branch and is the figure that
 * counts. `stock_quantity` is the shop-wide rollup and only the fallback — the
 * backend's own `InventoryService` calls it the legacy rollup. Reading the
 * rollup offers a size stacked high in another town and refuses one sitting on
 * the rail here.
 */
export function catalogSizeStock(v: ProductVariant): number {
  const branch = (v as { branch_stock?: number | string | null }).branch_stock;

  return Number(branch ?? v.stock_quantity ?? 0);
}

/**
 * The catalogue's figure for the whole product.
 *
 * A varianted product holds no stock of its own. `Product::effectiveStock()` on
 * the server says so outright — "the parent stock_quantity is an orphaned
 * leftover that must not be read as truth" — and the till was reading exactly
 * that, then greying the tile out on the result. A T-shirt with a full rail of
 * S, M and L rendered **out of stock and unpressable**, because the product form
 * seeds the parent row at zero and puts the quantities on the variants.
 */
export function catalogStock(p: {
  stock_quantity?: number | string | null;
  variants?: ProductVariant[] | null;
}): number {
  const sizes = sizesOf(p);
  if (sizes.length > 0) {
    return sizes.reduce((n, v) => n + catalogSizeStock(v), 0);
  }

  return Number(p.stock_quantity ?? 0);
}

/** How a caller adjusts the catalogue's figure — the till subtracts its unsent queue. */
export type StockReader = (product: { id: string }, variant: ProductVariant | null) => number;

/** The plain catalogue reading, for screens with no offline queue behind them. */
export const catalogReader: StockReader = (product, variant) =>
  variant !== null
    ? catalogSizeStock(variant)
    : catalogStock(product as Parameters<typeof catalogStock>[0]);

type Sellable = Pick<Product, "name" | "type" | "sold_out" | "track_inventory"> & {
  id: string;
  stock_quantity?: number | string | null;
  variants?: ProductVariant[] | null;
};

/**
 * Why this line cannot be rung, or null if it can.
 *
 * Asked per SIZE when there is one, because that is where the stock lives: a
 * rail with twelve Smalls and no Larges is not "in stock" to somebody who wants
 * a Large, and the product-level figure — the sum of the sizes — would say it
 * was.
 *
 * Sold-out beats every other reason. A dish that tracks no stock can never be
 * "out" by quantity, which is deliberate because food is made to order, so the
 * 86 flag is the only thing standing between a finished fish and a table that
 * has just ordered it.
 */
export function whyNotSellable(
  p: Sellable,
  variant: ProductVariant | null,
  stockOf: StockReader = catalogReader,
): string | null {
  // The SIZE first — it is the more specific answer and the one a customer
  // hears. "No large, but we have medium" is a sale; "no pizza" when only the
  // large ran out is a lost evening, and that is what the product-level flag
  // used to be the only way to say.
  if (variant !== null && (variant.sold_out_at ?? null) !== null) {
    return `${p.name} — ${variant.name} is sold out.`;
  }

  if (p.sold_out === true) return `${p.name} is sold out.`;

  if (p.type === "product" && p.track_inventory === true) {
    if (stockOf(p, variant) <= 0) {
      return variant !== null
        ? `${p.name} — ${variant.name} is out of stock`
        : `${p.name} is out of stock`;
    }
  }

  return null;
}
