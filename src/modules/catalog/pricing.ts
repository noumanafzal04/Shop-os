/**
 * WHAT A BUYER PAYS FOR ONE OF SOMETHING.
 *
 * An active sale price beats the regular price; a sale price of zero, of null,
 * or one that is somehow HIGHER than the regular price is not a sale and is
 * ignored. That last case is the reason this is a function rather than
 * `p.discount_price ?? p.price`: a shop that raises its regular price and
 * forgets to clear an old promotion would otherwise be charging the old,
 * higher figure as if it were a discount.
 *
 * Written once because it was written twice — identically, in the till and on
 * the new-sale screen — and a third copy was about to be typed for the order
 * form. Two screens quoting different prices for one product is the worst
 * possible outcome from a five-line function.
 *
 * This is DISPLAY only. The server prices every sale and every order for
 * itself; nothing here is ever sent as a price.
 */
export function sellingPrice(p: {
  price: string | number;
  discount_price?: string | number | null;
}): number {
  const price = Number(p.price);
  const sale = p.discount_price != null ? Number(p.discount_price) : null;

  return sale !== null && sale > 0 && sale < price ? sale : price;
}

/**
 * What one size of an item sells for — the server's `Product::priceOfSize`.
 *
 * Every size carries a price (the size grid fills a new one with the design's),
 * so a size with no price of its own is a size priced the same as the design.
 * That size follows the design, sale included: a kurta on sale at 4,990 rings
 * its S, M and L up at 4,990, as the list and the tile say. A size priced
 * differently is its own price, and the design's sale does not touch it.
 *
 * Unlike `sellingPrice`, the till's offline bill is built from this one.
 */
export function sizePrice(
  p: { price: string | number; discount_price?: string | number | null },
  size: { price: string | number },
): number {
  const own = Math.round(Number(size.price) * 100) / 100;

  return own === Math.round(Number(p.price) * 100) / 100 ? sellingPrice(p) : own;
}

/** Whether that price is a reduction, so a screen can strike the old one. */
export function onSale(p: { price: string | number; discount_price?: string | number | null }): boolean {
  return sellingPrice(p) < Number(p.price);
}
