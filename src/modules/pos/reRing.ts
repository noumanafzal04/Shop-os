import type { Product } from "../catalog/types";
import { round2 } from "../offline/pricing/money";
import type { Sale } from "../sales/types";

/**
 * RE-RING A BILL (Q19 B, the client 2026-10-17).
 *
 * The bill is printed and the customer wants it changed. The till loads the
 * bill back onto the counter, the cashier changes it, and on Complete the
 * server voids the old bill as re-rung and rings the new one — carrying what
 * was already paid, the way it was paid. Only the difference crosses the
 * counter, so that is all the till asks for: the amount due is the new bill
 * less what was paid, and a smaller bill hands the rest back.
 *
 * Pure, so the rules are tested without a till.
 */
export interface ReRinging {
  id: string;
  invoice_number: string;
  /** What was paid and how, as the server will carry it. */
  carried: Array<{ method: string; amount: number }>;
  /** All of it, together. */
  paid: number;
}

/** From the server's answer about the bill — null when it may not be re-rung. */
export function reRingingOf(sale: Pick<Sale, "id" | "invoice_number" | "re_ring">): ReRinging | null {
  const quote = sale.re_ring;
  if (!quote || !quote.open) return null;

  return {
    id: sale.id,
    invoice_number: sale.invoice_number,
    carried: quote.carried,
    paid: round2(quote.carried.reduce((sum, t) => sum + Number(t.amount), 0)),
  };
}

/**
 * The bill as the ring-again planner reads a slip (`planRingAgain`): the same
 * items, sizes, quantities, packs, options, discounts and serial numbers. A
 * sale line keeps its pack and its options by NAME, so they are found again
 * on the item as it is now; one that is not there any more is named instead.
 */
export function slipOf(
  sale: Pick<Sale, "items" | "serials">,
  find: (productId: string) => Product | undefined,
): { sale: { items: Array<Record<string, unknown>> }; left: string[] } {
  const items: Array<Record<string, unknown>> = [];
  const left: string[] = [];

  for (const line of sale.items ?? []) {
    if (line.product_id === null) continue;
    const product = find(line.product_id);
    const name = line.variant_name ? `${line.product_name} / ${line.variant_name}` : line.product_name;

    let unitId: string | null = null;
    if (product !== undefined && line.unit_name) {
      unitId = (product.units ?? []).find((u) => u.name === line.unit_name)?.id ?? null;
      if (unitId === null) {
        left.push(`${name}: the ${line.unit_name} is no longer sold.`);
        continue;
      }
    }

    const optionIds: string[] = [];
    let optionsGone = false;
    for (const chosen of line.modifiers ?? []) {
      const group = (product?.modifier_groups ?? []).find((g) => g.name === chosen.group);
      const option = (group?.options ?? []).find((o) => o.name === chosen.name);
      if (option?.id) optionIds.push(option.id);
      else optionsGone = true;
    }
    if (product !== undefined && optionsGone) {
      left.push(`${name}: one of its options is no longer offered.`);
      continue;
    }

    items.push({
      product_id: line.product_id,
      variant_id: line.variant_id,
      quantity: Number(line.quantity),
      product_unit_id: unitId,
      ...(Number(line.line_discount ?? 0) > 0 ? { line_discount: Number(line.line_discount) } : {}),
      ...(optionIds.length > 0 ? { modifier_option_ids: optionIds } : {}),
      serials: (sale.serials ?? []).filter((s) => s.sale_item_id === line.id && !s.returned_at).map((s) => s.serial),
    });
  }

  return { sale: { items }, left };
}

/**
 * What changes hands: the new bill less what was paid. A smaller bill hands
 * the rest back — in cash, so only as far as cash was paid: a card bill
 * cannot shrink into notes the drawer never took (the server refuses it too).
 */
export function reRingDifference(
  bill: number,
  r: Pick<ReRinging, "carried" | "paid">,
  money: (n: number) => string,
): { take: number; back: number; blocked: string | null } {
  const difference = round2(bill - r.paid);
  const back = Math.max(0, -difference);
  const cash = round2(r.carried.filter((t) => t.method === "cash").reduce((sum, t) => sum + Number(t.amount), 0));

  return {
    take: Math.max(0, difference),
    back,
    blocked: back > cash + 0.001
      ? `The old bill was paid ${cash > 0 ? "partly " : ""}by card or khata — this one has to come to at least ${money(round2(r.paid - cash))}. To give more back, take the items back with Return / Refund.`
      : null,
  };
}
