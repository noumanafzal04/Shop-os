import { round2 } from "./money";
import { priceCart, type CartLine, type ShopPricing } from "./priceCart";

/**
 * Checking the offline pricing engine against the server, on real carts, before
 * anything is allowed to depend on it.
 *
 * ── Why fixtures are not enough ─────────────────────────────────────────
 *
 * The golden fixtures pin twenty-six carts somebody thought of. A shop rings
 * five hundred a day that nobody thought of — a weighed item at an odd quantity,
 * three tax rates and a hand-keyed discount, a tier and a flash sale on the same
 * line. Shipping offline selling on the strength of carts we invented would be
 * trusting our own imagination about a shop's till.
 *
 * So while the POS is still selling ONLINE, every completed sale is priced a
 * second time by the offline engine and the two answers are compared. The
 * customer is charged the server's price, exactly as before; the local one is
 * computed, discarded, and only the DISAGREEMENTS are kept.
 *
 * Two weeks of that is a real answer to "does the mirror work", built out of
 * real carts. If it produces nothing, offline selling can ship. If it produces
 * anything at all, each one is a bug found for the price of a comparison rather
 * than for the price of a wrong receipt.
 *
 * ── What it must never do ───────────────────────────────────────────────
 *
 * Change what the customer pays, delay a sale, or interrupt a cashier. It runs
 * AFTER the sale is complete and it never throws — not while pricing, and not
 * while describing the cart it failed to price. A shadow check that broke a
 * till would be the worst possible trade, and the cart most likely to break it
 * is exactly the one worth reporting.
 */

/** What the server said, taken from the sale it just created. */
export interface ServerTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/** One disagreement, in enough detail to reproduce it. */
export interface PricingVariance {
  /** The sale the server created, so the row can be looked up. */
  saleId: string;
  at: string;
  server: ServerTotals;
  local: ServerTotals;
  /** Which figures differ, and by how much. Never empty. */
  differences: Array<{ field: keyof ServerTotals; server: number; local: number; by: number }>;
  /** Enough of the cart to re-run it by hand. */
  cart: {
    settings: ShopPricing;
    discount: number;
    lines: Array<{
      price: number;
      discount_price: number | null;
      wholesale_price: number | null;
      price_tiers: unknown;
      tax_rate: number | null;
      tax_group_rate: number | null;
      quantity: number;
      priceLevel: string;
      lineDiscountPct: number | null;
      lineDiscount: number | null;
    }>;
  };
}

const FIELDS: Array<keyof ServerTotals> = ["subtotal", "discount", "tax", "total"];

/**
 * Price the cart locally and say how it differs from the server, or null.
 *
 * Null is the answer we want and expect: the engine agreed. Anything else is
 * something to look at before a till is allowed to price on its own.
 *
 * Comparison is exact. A tolerance would be the wrong kindness — the whole
 * claim being tested is agreement to the paisa, and "close enough" is how a
 * drawer drifts by a rupee a day.
 */
export function comparePricing(
  saleId: string,
  lines: CartLine[],
  shop: ShopPricing,
  cartDiscount: number,
  server: ServerTotals,
  now: () => string = () => new Date().toISOString(),
): PricingVariance | null {
  let local: ServerTotals;

  try {
    const priced = priceCart(lines, shop, cartDiscount);
    local = {
      subtotal: priced.subtotal,
      discount: priced.discount,
      tax: priced.tax,
      total: priced.total,
    };
  } catch {
    // The engine could not price a cart the server priced fine. That is itself
    // the most interesting possible result, so it is recorded as a total
    // disagreement rather than swallowed.
    local = { subtotal: NaN, discount: NaN, tax: NaN, total: NaN };
  }

  const differences = FIELDS.filter((field) => !sameMoney(server[field], local[field])).map(
    (field) => ({
      field,
      server: server[field],
      local: local[field],
      by: Number.isFinite(local[field]) ? round2(local[field] - server[field]) : NaN,
    }),
  );

  if (differences.length === 0) return null;

  return {
    saleId,
    at: now(),
    server,
    local,
    differences,
    cart: {
      settings: shop,
      discount: cartDiscount,
      lines: describeCart(lines),
    },
  };
}

/**
 * Describe the cart, per line, never throwing.
 *
 * Defensive per LINE rather than around the whole loop: the cart most likely to
 * make this fail is the one most worth reporting, and losing the other nine
 * lines because the third could not be read throws away the context somebody
 * needs to reproduce it.
 */
function describeCart(lines: CartLine[]): PricingVariance["cart"]["lines"] {
  const described: PricingVariance["cart"]["lines"] = [];

  for (let index = 0; index < lines.length; index += 1) {
    try {
      const line = lines[index];
      described.push({
        price: line.item.price,
        discount_price: line.item.discount_price,
        wholesale_price: line.item.wholesale_price,
        price_tiers: line.item.price_tiers,
        tax_rate: line.item.tax_rate,
        tax_group_rate: line.item.tax_group_rate ?? null,
        quantity: line.quantity,
        priceLevel: line.priceLevel ?? "retail",
        lineDiscountPct: line.lineDiscountPct ?? null,
        lineDiscount: line.lineDiscount ?? null,
      });
    } catch {
      // "Line 3 was unreadable" is a usable bug report; a missing row is not.
      described.push({
        price: NaN,
        discount_price: null,
        wholesale_price: null,
        price_tiers: null,
        tax_rate: null,
        tax_group_rate: null,
        quantity: NaN,
        priceLevel: `unreadable line ${index}`,
        lineDiscountPct: null,
        lineDiscount: null,
      });
    }
  }

  return described;
}

/**
 * Exact, and the finiteness check is not decoration.
 *
 * NaN needs no help — `NaN === NaN` is already false, so a cart the engine
 * could not price reports as a difference on its own. INFINITY does need help:
 * `Infinity === Infinity` is TRUE, so two numbers that are both "off the scale"
 * would compare equal and be filed as agreement. That is the one shape where a
 * plain equality check reports the opposite of the truth, which is precisely
 * the reading nobody would go back and check.
 */
function sameMoney(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;

  return a === b;
}
