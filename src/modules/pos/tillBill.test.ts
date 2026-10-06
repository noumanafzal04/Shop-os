import { describe, expect, it } from "vitest";
import { effectiveTaxRate } from "../offline/pricing/priceCart";
import { round2 } from "../offline/pricing/money";
import fixtures from "./fixtures/till-bill.json";
import { lineNet, lineUnit } from "./lineMath";
import { followLevel, settleInCoins, tillBill, type BillGroup, type BillLine, type PriceLevel } from "./tillBill";

/**
 * EVERY BILL THE SERVER WAS ASKED TO MAKE, made again by the counter screen.
 *
 * The fixtures are rung through the real endpoint by `TillBillFixturesTest`
 * and copied here. Nothing below works an answer out — each case is the
 * server's own, and the only question is whether the till arrives at it.
 *
 * Three of these bills were wrong on the screen before this file existed:
 * every one with a customer's group in it, and cash beside a trade-in.
 */

interface FixtureItem {
  price: number;
  discount_price: number | null;
  wholesale_price: number | null;
  price_tiers: Array<{ min_qty: number; price: number }> | null;
  tax_rate: number | null;
  tax_group_rate: number | null;
  quantity: number;
  line_discount_pct: number | null;
  line_discount: number | null;
  price_level: PriceLevel | null;
}

interface FixtureBill {
  name: string;
  input: {
    settings: { default_tax_rate: number; tax_inclusive: boolean; cash_rounding: number; loyalty_redeem_value: number };
    items: FixtureItem[];
    group: BillGroup | null;
    discount: number;
    redeem_points: number;
    method: string;
    trade_in: number;
    tip: number;
  };
  expected: {
    lines: Array<{ unit_price: number; line_total: number; tax_rate: number }>;
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
    payable: number;
    rounding: number;
  };
}

const BILLS = (fixtures as { version: number; bills: FixtureBill[] }).bills;

/** A cart line exactly as `addLine` makes one: selling price on both fields. */
function lineFrom(item: FixtureItem): BillLine {
  const sale = item.discount_price != null && item.discount_price > 0 && item.discount_price < item.price
    ? item.discount_price
    : item.price;

  return {
    unit_price: sale,
    base_price: sale,
    quantity: item.quantity,
    wholesale_price: item.wholesale_price,
    price_tiers: item.price_tiers,
    // Unset unless the cashier chose: that is what lets a line follow the customer.
    price_level: item.price_level ?? undefined,
    ...(item.line_discount_pct != null
      ? { discountValue: item.line_discount_pct, discountMode: "pct" }
      : item.line_discount != null
        ? { discountValue: item.line_discount, discountMode: "amt" }
        : {}),
    tax_rate: item.tax_rate,
    tax_group_rate: item.tax_group_rate,
  };
}

function billFor(c: FixtureBill) {
  return tillBill({
    lines: c.input.items.map(lineFrom),
    group: c.input.group,
    defaultTaxRate: c.input.settings.default_tax_rate,
    taxInclusive: c.input.settings.tax_inclusive,
    discount: c.input.discount,
    redeemPoints: c.input.redeem_points,
    redeemValue: c.input.settings.loyalty_redeem_value,
    tradeIn: c.input.trade_in,
    tip: c.input.tip,
    tenders: [c.input.method],
    cashRounding: c.input.settings.cash_rounding,
  });
}

describe("the fixtures themselves", () => {
  it("are the shape this file was written against", () => {
    expect((fixtures as { version: number }).version).toBe(2);
  });

  it("contain the cases that were wrong — a test of nothing passes too", () => {
    // THE DENOMINATOR. Every reason this file exists has to be in it, or a
    // regenerated set that dropped them would leave it green and blind.
    expect(BILLS.filter((b) => (b.input.group?.discount_percent ?? 0) > 0).length).toBeGreaterThanOrEqual(5);
    expect(BILLS.filter((b) => b.input.group?.price_level === "wholesale").length).toBeGreaterThanOrEqual(4);
    expect(BILLS.filter((b) => b.expected.rounding !== 0).length).toBeGreaterThanOrEqual(4);
    expect(BILLS.filter((b) => b.input.trade_in > 0 && b.input.method === "cash").length).toBeGreaterThanOrEqual(2);
    expect(BILLS.some((b) => b.input.settings.tax_inclusive)).toBe(true);
    expect(BILLS.some((b) => b.input.redeem_points > 0)).toBe(true);
    // A tip — and one whose coin moves, on cash, by an amount that is not a
    // round step: the only tip that tells "added before the coin" from
    // "added after it".
    expect(BILLS.filter((b) => b.input.tip > 0).length).toBeGreaterThanOrEqual(3);
    expect(BILLS.some((b) => b.input.tip > 0 && b.input.tip % b.input.settings.cash_rounding !== 0 && b.expected.rounding !== 0)).toBe(true);
  });
});

describe("every bill the server made, made again by the till", () => {
  it.each(BILLS.map((b) => [b.name, b] as const))("%s", (_name, c) => {
    const bill = billFor(c);

    // The figure the cashier reads out, first: it is the one that matters.
    expect(bill.payable, "what the customer hands over").toBe(c.expected.payable);
    expect(bill.total).toBe(c.expected.total);
    expect(bill.tax).toBe(c.expected.tax);
    expect(bill.discount).toBe(c.expected.discount);
    expect(bill.subtotal).toBe(c.expected.subtotal);
    expect(bill.rounding).toBe(c.expected.rounding);

    bill.lines.forEach((line, i) => {
      expect(round2(lineUnit(line)), `line ${i} unit price`).toBe(c.expected.lines[i].unit_price);
      expect(lineNet(line), `line ${i} total`).toBe(c.expected.lines[i].line_total);
      expect(effectiveTaxRate(line, c.input.settings.default_tax_rate), `line ${i} rate`).toBe(c.expected.lines[i].tax_rate);
    });
  });
});

describe("a line follows the customer until the cashier says otherwise", () => {
  const line: BillLine = { unit_price: 1000, base_price: 1000, wholesale_price: 900, quantity: 1 };
  const trade: BillGroup = { price_level: "wholesale", discount_percent: 0 };

  it("an unset line takes a trade customer's level", () => {
    expect(lineUnit(followLevel(line, trade))).toBe(900);
  });

  it("a line the cashier set keeps what they set", () => {
    expect(lineUnit(followLevel({ ...line, price_level: "retail" }, trade))).toBe(1000);
  });

  it("nobody special, or a retail group, changes nothing", () => {
    expect(followLevel(line, null)).toBe(line);
    expect(followLevel(line, { price_level: "retail", discount_percent: 10 })).toBe(line);
  });
});

describe("coins", () => {
  it("only the steps a shop may choose", () => {
    // 3 is not a coin anybody settles to; the server ignores it, so must this.
    expect(settleInCoins(1234, 3)).toBe(1234);
    expect(settleInCoins(1234, 10)).toBe(1230);
  });

  it("a split that is all cash settles to the coin, and one with a card does not", () => {
    const base = {
      lines: [{ unit_price: 1234, base_price: 1234, quantity: 1, tax_rate: 0 }],
      group: null, defaultTaxRate: 0, taxInclusive: false, discount: 0, cashRounding: 10,
    };

    expect(tillBill({ ...base, tenders: ["cash", "cash"] }).payable).toBe(1230);
    expect(tillBill({ ...base, tenders: ["cash", "card"] }).payable).toBe(1234);
  });
});
