import type { Product, ProductVariant } from "../catalog/types";

/**
 * RINGING A REFUSED SALE AGAIN (B49) — what can go back on the bill.
 *
 * The slip is the sale exactly as the till queued it: ids and quantities, no
 * names, no prices (the server prices every sale). So each line is matched to
 * the shop's catalogue AS IT IS NOW and put through the same fence as a tap on
 * a tile. A line that cannot pass — the item deleted or switched off since,
 * which is usually why the sale was refused at all — is not rung; it is named,
 * so the cashier can put a replacement on the bill or take it off.
 *
 * Pure, so the rule is tested without a till.
 */

export interface LineToRing {
  product: Product;
  size: ProductVariant | null;
  quantity: number;
  unitId: string | null;
  priceLevel?: "retail" | "wholesale";
  discount: { value: number; mode: "amt" | "pct" } | null;
  options: { ids: string[]; label: string | undefined; delta: number } | null;
  serials: string[];
  directions?: string;
}

export interface RingAgainPlan {
  lines: LineToRing[];
  /** What did not go back on, in words the cashier can act on. */
  left: string[];
}

/** What the slip said about the bill as a whole. */
export interface SlipBill {
  customerName: string;
  customerPhone: string;
  discount: number;
  /** A single simple tender; null for a split or khata, which is chosen again. */
  method: "cash" | "card" | "wallet" | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const amount = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function planRingAgain(
  sale: Record<string, unknown>,
  /** The item as the shop has it now — undefined when it is gone. */
  find: (productId: string) => Product | undefined,
  /** The till's own fence: why a tap on this item would be refused, or null. */
  whyNot: (product: Product, size: ProductVariant | null) => string | null,
): RingAgainPlan {
  const items = Array.isArray(sale.items) ? (sale.items as Array<Record<string, unknown>>) : [];
  const plan: RingAgainPlan = { lines: [], left: [] };
  let gone = 0;

  for (const item of items) {
    const id = text(item?.product_id);
    const product = id === null ? undefined : find(id);
    if (product === undefined) {
      gone += 1;
      continue;
    }

    const sizeId = text(item.variant_id);
    const size = sizeId === null ? null : (product.variants ?? []).find((v) => v.id === sizeId) ?? null;
    if (sizeId !== null && size === null) {
      plan.left.push(`${product.name}: that size is no longer sold.`);
      continue;
    }
    const name = size ? `${product.name} / ${size.name}` : product.name;

    if (product.is_active === false) {
      plan.left.push(`${name}: switched off since it was rung.`);
      continue;
    }
    if (amount(item.amount) !== null && amount(item.quantity) === null) {
      plan.left.push(`${name}: rung as an amount of money — ring it by hand.`);
      continue;
    }
    const quantity = amount(item.quantity);
    if (quantity === null || quantity <= 0) {
      plan.left.push(`${name}: the quantity could not be read.`);
      continue;
    }

    const unitId = text(item.product_unit_id);
    if (unitId !== null && !(product.units ?? []).some((u) => u.id === unitId)) {
      plan.left.push(`${name}: that pack is no longer sold.`);
      continue;
    }

    const optionIds = Array.isArray(item.modifier_option_ids) ? item.modifier_option_ids.filter((o): o is string => typeof o === "string") : [];
    let options: LineToRing["options"] = null;
    if (optionIds.length > 0) {
      const all = (product.modifier_groups ?? []).flatMap((g) => g.options ?? []);
      const chosen = optionIds.map((oid) => all.find((o) => o.id === oid));
      if (chosen.some((o) => o === undefined)) {
        plan.left.push(`${name}: one of its options is no longer offered.`);
        continue;
      }
      options = {
        ids: optionIds,
        label: chosen.map((o) => o!.name).join(", ") || undefined,
        delta: chosen.reduce((sum, o) => sum + Number(o!.price_delta ?? 0), 0),
      };
    }

    const refused = whyNot(product, size);
    if (refused !== null) {
      plan.left.push(refused);
      continue;
    }

    const pct = amount(item.line_discount_pct);
    const off = amount(item.line_discount);
    const level = item.price_level === "retail" || item.price_level === "wholesale" ? item.price_level : undefined;
    plan.lines.push({
      product,
      size,
      quantity,
      unitId,
      priceLevel: level,
      discount: pct !== null && pct > 0 ? { value: pct, mode: "pct" } : off !== null && off > 0 ? { value: off, mode: "amt" } : null,
      options,
      serials: Array.isArray(item.serials) ? item.serials.filter((s): s is string => typeof s === "string") : [],
      directions: text(item.directions) ?? undefined,
    });
  }

  if (gone > 0) {
    plan.left.unshift(
      gone === 1
        ? "One item the shop no longer has — deleted since it was rung."
        : `${gone} items the shop no longer has — deleted since they were rung.`,
    );
  }

  return plan;
}

export function slipBill(sale: Record<string, unknown>): SlipBill {
  const method = sale.payment_method;

  return {
    customerName: text(sale.customer_name) ?? "",
    customerPhone: text(sale.customer_phone) ?? "",
    discount: Math.max(0, amount(sale.discount) ?? 0),
    method: !Array.isArray(sale.payments) && (method === "cash" || method === "card" || method === "wallet") ? method : null,
  };
}
