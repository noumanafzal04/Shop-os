import type { Product } from "../catalog/types";

/**
 * WHAT A PHONE ORDER MAY BE GIVEN OF ONE ITEM.
 *
 * ── What was wrong ───────────────────────────────────────────────────
 *
 * The Take-order page judged every product by its stock figure, and a dish is
 * made to order: nobody counts it, so its figure is nought. Every dish without
 * sizes read "none left" and could not be pressed — a restaurant could not take
 * a phone order for its own biryani. The server, asked, would have said yes:
 * it checks stock only for what the shop counts.
 *
 * So the page asks the same three questions the server does, in one place:
 *
 *   a service is never short
 *   an item nobody counts is never short           ← the one that was missing
 *   an item with sizes keeps its count on the sizes, and this form cannot
 *     choose a size — so it is left alone rather than judged against a parent
 *     row that is always nought
 *
 * `null` is "there is no count to show"; a number is what is on the shelf.
 */
type Counted = Pick<Product, "type" | "track_inventory" | "stock_quantity" | "variants">;

export function leftOf(p: Counted): number | null {
  if (p.type !== "product") return null;
  if (p.track_inventory !== true) return null;
  if ((p.variants ?? []).length > 0) return null;

  return Number(p.stock_quantity);
}

/**
 * Why this item cannot go on an order right now — or `null` if it can.
 *
 * Taken off the menu for today (the kitchen's "86") beats the shelf: a dish
 * nobody counts can still have run out, and that switch is the only thing that
 * says so.
 */
export function whyNotOrderable(p: Counted & Pick<Product, "sold_out">): "off" | "none left" | null {
  if (p.sold_out === true) return "off";
  const left = leftOf(p);

  return left !== null && left <= 0 ? "none left" : null;
}
