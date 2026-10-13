import { sellingPrice, sizePrice } from "../catalog/pricing";
import type { ModifierGroup, ModifierOption, Product, ProductVariant } from "../catalog/types";
import { sizesOf } from "../pos/availability";

/**
 * A LINE OF AN ORDER BEING TAKEN — the dish, WHICH size, and what was asked
 * of it.
 *
 * The Take-order page kept one line per product. So it could not hold a Half
 * and a Full of the same karahi, could not say which the caller wanted — it
 * sent the dish with no size at all, at the parent row's price — and could not
 * answer a dish's question, which the server then refused when the order was
 * sent. A line is now what a waiter writes on a pad: the dish, its size, and
 * its answers.
 */
export interface OrderLine {
  key: string;
  product: Product;
  variant: ProductVariant | null;
  options: ModifierOption[];
  qty: number;
}

/** What was chosen in the sheet: a size, and the options ticked in each group. */
export interface Choice {
  variantId: string | null;
  /** Option ids by group — keyed by the group's id, or its name where it has none yet. */
  byGroup: Record<string, string[]>;
}

export const groupKey = (g: ModifierGroup): string => g.id ?? g.name;

/** Two taps of the same dish, size and answers are ONE line of two. */
export function lineKey(productId: string, variantId: string | null, optionIds: string[]): string {
  return [productId, variantId ?? "", ...[...optionIds].sort()].join("|");
}

/** Does this dish have to be ASKED about before it can go on the order? */
export function asksFirst(p: Product): boolean {
  return sizesOf(p).length > 0 || (p.modifier_groups ?? []).some((g) => (g.options ?? []).length > 0);
}

/** `max_select` of 0 is "as many as you like". */
const atMost = (g: ModifierGroup): number => (g.max_select > 0 ? g.max_select : Number.POSITIVE_INFINITY);

export function groupIsAnswered(g: ModifierGroup, chosen: string[]): boolean {
  return chosen.length >= g.min_select && chosen.length <= atMost(g);
}

/** Tick or untick one option, the way the group allows. */
export function toggled(g: ModifierGroup, chosen: string[], optionId: string): string[] {
  if (chosen.includes(optionId)) return chosen.filter((id) => id !== optionId);
  // One answer only: the new one replaces the old.
  if (atMost(g) === 1) return [optionId];
  // Full: nothing more goes in until something comes out.
  if (chosen.length >= atMost(g)) return chosen;

  return [...chosen, optionId];
}

/** May the dish go on the order as chosen? A size where it has sizes, and every question answered. */
export function choiceIsComplete(p: Product, choice: Choice): boolean {
  if (sizesOf(p).length > 0 && choice.variantId === null) return false;

  return (p.modifier_groups ?? []).every((g) => groupIsAnswered(g, choice.byGroup[groupKey(g)] ?? []));
}

/** What to say is still missing — the first thing, in words. */
export function whatIsMissing(p: Product, choice: Choice): string | null {
  if (sizesOf(p).length > 0 && choice.variantId === null) return "Choose a size.";
  const open = (p.modifier_groups ?? []).find((g) => !groupIsAnswered(g, choice.byGroup[groupKey(g)] ?? []));
  if (!open) return null;

  return (choice.byGroup[groupKey(open)] ?? []).length < open.min_select
    ? `Choose ${open.min_select === 1 ? "one" : open.min_select} for ${open.name}.`
    : `No more than ${open.max_select} for ${open.name}.`;
}

/**
 * What one of it costs, as chosen — the size's own price, or the dish's, and
 * what each extra adds. An INDICATION for the sheet while it is being filled;
 * the order's own figure comes from the server (`/orders/worth`).
 */
export function unitPriceOf(p: Product, variant: ProductVariant | null, options: ModifierOption[]): number {
  const base = variant !== null ? sizePrice(p, variant) : sellingPrice(p);

  return Math.round((base + options.reduce((sum, o) => sum + Number(o.price_delta), 0)) * 100) / 100;
}

/** "Chicken Karahi (Full)" */
export function lineName(l: Pick<OrderLine, "product" | "variant">): string {
  return l.variant !== null ? `${l.product.name} (${l.variant.name})` : l.product.name;
}

/** "Hot · Extra naan" — or nothing. */
export function lineAnswers(l: Pick<OrderLine, "options">): string {
  return l.options.map((o) => o.name).join(" · ");
}

/** The line a choice makes. */
export function lineOf(p: Product, choice: Choice, qty = 1): OrderLine {
  const variant = sizesOf(p).find((v) => v.id === choice.variantId) ?? null;
  const options = (p.modifier_groups ?? []).flatMap((g) =>
    (g.options ?? []).filter((o) => o.id !== undefined && (choice.byGroup[groupKey(g)] ?? []).includes(o.id)),
  );

  return { key: lineKey(p.id, variant?.id ?? null, options.map((o) => o.id!)), product: p, variant, options, qty };
}

/** What the order says to the server about its lines — the question and the order use the same words. */
export function itemsOf(lines: OrderLine[]): Array<{ product_id: string; variant_id: string | null; quantity: number; modifier_option_ids: string[] }> {
  return lines.map((l) => ({
    product_id: l.product.id,
    variant_id: l.variant?.id ?? null,
    quantity: l.qty,
    modifier_option_ids: l.options.map((o) => o.id!).filter(Boolean),
  }));
}
