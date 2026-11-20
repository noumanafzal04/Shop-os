import type { CartLine } from "../../stores/cartStore";

/**
 * "ORDER AGAIN" — what a past order puts back in the basket.
 *
 * Plain items go straight in, at the price on the old receipt (checkout asks
 * the server for today's price anyway — `/customer/orders/worth`). Some lines
 * cannot be rebuilt from an order and are named instead, for the person to
 * choose again on the shop page:
 *   - a product the shop has since deleted (no id left on the line);
 *   - a line with food choices — the order keeps their NAMES, not the option
 *     ids the basket needs;
 *   - a pack line (a strip, a carton) — the basket has no pack.
 */
export interface PastLine {
  product_id?: string | null;
  variant_id?: string | null;
  product_unit_id?: string | null;
  product_name: string;
  variant_name: string | null;
  quantity: number | string;
  line_total: string | number;
  modifiers?: unknown[] | null;
}

export interface ReorderPlan {
  lines: Array<{ line: Omit<CartLine, "quantity">; qty: number }>;
  skipped: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function reorderPlan(items: PastLine[]): ReorderPlan {
  const lines: ReorderPlan["lines"] = [];
  const skipped: string[] = [];
  for (const it of items) {
    const qty = Number(it.quantity);
    const label = it.variant_name ? `${it.product_name} / ${it.variant_name}` : it.product_name;
    if (!it.product_id || it.product_unit_id || (it.modifiers?.length ?? 0) > 0 || !(qty > 0)) {
      skipped.push(label);
      continue;
    }
    const whole = Number.isInteger(qty);
    lines.push({
      line: {
        product_id: it.product_id,
        variant_id: it.variant_id ?? null,
        name: label,
        unit_price: round2(Number(it.line_total) / qty),
        ...(whole ? {} : { sold_by: "weight" as const }),
      },
      qty,
    });
  }
  return { lines, skipped };
}

/** The sentence after "Order again" when some lines could not go back in. */
export function skippedNote(skipped: string[]): string | null {
  if (skipped.length === 0) return null;
  const first = skipped.slice(0, 2).join(", ");
  const more = skipped.length > 2 ? ` and ${skipped.length - 2} more` : "";
  return `Choose ${first}${more} again on the shop page — options aren't carried over.`;
}
