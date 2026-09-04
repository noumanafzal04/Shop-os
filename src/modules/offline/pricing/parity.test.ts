import { describe, expect, it } from "vitest";

import fixtures from "./fixtures/pricing.json";
import { round2 } from "./money";
import { priceCart, type CartLine, type PriceLevel } from "./priceCart";
import type { CatalogPromotion } from "../sync/catalogService";

/**
 * The gate. Nothing sells offline until this file is green.
 *
 * Every expected number here was produced by ringing a real sale through the
 * real endpoint on the server — not by a second implementation of the pricing
 * rules, which could be wrong in the same way this one is and would agree with
 * itself forever.
 *
 * The lock has two sides and both are needed. On the server,
 * `PricingFixturesTest` re-rings every cart and fails if the answers moved —
 * that catches a pricing rule changing under a till that is still computing the
 * old one. Here, the same fixtures are fed to the offline engine and must come
 * back identical — that catches the mirror drifting from what it mirrors.
 *
 * When a pricing rule legitimately changes: regenerate on the server with
 * `SHOPOS_WRITE_FIXTURES=1`, read the diff, copy the file here, and expect this
 * to go red until the engine is updated to match. That red is the feature.
 */

interface RoundingCase {
  value: number;
  expected: number;
}

interface FixtureItem {
  product_id: string;
  category_id: string | null;
  price: number;
  discount_price: number | null;
  wholesale_price: number | null;
  price_tiers: Array<{ min_qty: number; price: number }> | null;
  tax_rate: number | null;
  tax_group_rate: number | null;
  sold_by: string;
  quantity: number;
  /**
   * The money this line named, where it named money. The server derived the
   * quantity beside it; this engine must reach the same total from the same
   * two figures rather than recomputing one from the other.
   */
  amountAsked: number | null;
  price_level: string;
  line_discount_pct: number | null;
  line_discount: number | null;
}

interface CartFixture {
  name: string;
  input: {
    settings: { tax_inclusive: boolean; default_tax_rate: number; cash_rounding: number };
    items: FixtureItem[];
    discount: number;
    /** The shop's automatic promotions, in exactly the projection shape. */
    promotions: CatalogPromotion[];
  };
  expected: {
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
    lines: Array<{ unit_price: number; line_total: number; tax_rate: number }>;
  };
}

const FIXTURES = fixtures as unknown as {
  version: number;
  rounding: RoundingCase[];
  carts: CartFixture[];
};

/** The shape this file understands. A bump means the copy here is stale. */
const EXPECTED_VERSION = 2;

describe("the fixtures themselves", () => {
  it("are the version this engine was written against", () => {
    // A silently stale copy is the failure mode this whole arrangement exists
    // to prevent: the engine would keep passing against yesterday's server.
    expect(FIXTURES.version).toBe(EXPECTED_VERSION);
  });

  it("actually contain something to check", () => {
    // An empty fixture file passes every assertion below it.
    expect(FIXTURES.rounding.length).toBeGreaterThan(10);
    expect(FIXTURES.carts.length).toBeGreaterThan(15);
  });
});

describe("rounding money the way the server does", () => {
  it.each(FIXTURES.rounding.map((c) => [c.value, c.expected] as const))(
    "round2(%s) === %s",
    (value, expected) => {
      expect(round2(value)).toBe(expected);
    },
  );

  it("differs from naive JavaScript on values a shop actually rings", () => {
    // The reason this file exists. If these ever agreed, the correction could
    // be deleted — and this asserts they do not, so nobody deletes it thinking
    // it was decoration.
    const divergent = [1.005, 1.015, 0.145];

    for (const value of divergent) {
      const naive = Math.round(value * 100) / 100;
      expect(round2(value), `round2(${value})`).not.toBe(naive);
    }
  });

  it("never produces negative zero", () => {
    // A receipt reading "-0.00" is a support call.
    expect(Object.is(round2(-0.001), -0)).toBe(false);
    expect(round2(-0.001)).toBe(0);
  });
});

/**
 * The shop as the fixture describes it.
 *
 * Every fixture promotion is deliberately always-live — no dates, no weekdays,
 * no time window — so the clock passed here cannot change an answer. A fixture
 * whose result depended on the day it ran would go red on a Tuesday for
 * reasons that are not about pricing; the window rules are pinned in
 * `bestPromotion.test.ts` against a fixed clock instead.
 */
const shopFor = (fixture: CartFixture) => ({
  default_tax_rate: fixture.input.settings.default_tax_rate,
  tax_inclusive: fixture.input.settings.tax_inclusive,
  promotions: fixture.input.promotions,
  now: new Date("2026-08-11T09:00:00Z"),
  timezone: "Asia/Karachi",
});

describe("every cart the server was asked to price", () => {
  const toLines = (fixture: CartFixture): CartLine[] =>
    fixture.input.items.map((item) => ({
      item: {
        id: item.product_id,
        category_id: item.category_id,
        price: item.price,
        discount_price: item.discount_price,
        wholesale_price: item.wholesale_price,
        price_tiers: item.price_tiers,
        tax_rate: item.tax_rate,
        tax_group_rate: item.tax_group_rate,
      },
      quantity: item.quantity,
      amountAsked: item.amountAsked,
      priceLevel: (item.price_level as PriceLevel) ?? "retail",
      lineDiscountPct: item.line_discount_pct,
      lineDiscount: item.line_discount,
    }));

  it.each(FIXTURES.carts.map((c) => [c.name, c] as const))("%s", (_name, fixture) => {
    const result = priceCart(
      toLines(fixture),
      shopFor(fixture),
      fixture.input.discount,
    );

    // Totals first: they are what a customer is charged and what a drawer is
    // counted against.
    expect(result.subtotal, "subtotal").toBe(fixture.expected.subtotal);
    expect(result.discount, "discount").toBe(fixture.expected.discount);
    expect(result.tax, "tax").toBe(fixture.expected.tax);
    expect(result.total, "total").toBe(fixture.expected.total);

    // Then the lines, because a receipt shows them and a return reads them back.
    expect(result.lines).toHaveLength(fixture.expected.lines.length);
    fixture.expected.lines.forEach((expectedLine, index) => {
      expect(result.lines[index].unit_price, `line ${index} unit price`).toBe(expectedLine.unit_price);
      expect(result.lines[index].line_total, `line ${index} total`).toBe(expectedLine.line_total);
      expect(result.lines[index].tax_rate, `line ${index} tax rate`).toBe(expectedLine.tax_rate);
    });
  });
});

describe("the whole set, not just the ones that pass", () => {
  it("prices every fixture without throwing", () => {
    // A cart that throws would otherwise be an individually red test among
    // green ones; this says how many the engine can price at all.
    const priced = FIXTURES.carts.filter((fixture) => {
      try {
        priceCart(
          fixture.input.items.map((item) => ({
            item: {
              id: item.product_id,
              category_id: item.category_id,
              price: item.price,
              discount_price: item.discount_price,
              wholesale_price: item.wholesale_price,
              price_tiers: item.price_tiers,
              tax_rate: item.tax_rate,
              tax_group_rate: item.tax_group_rate,
            },
            quantity: item.quantity,
            priceLevel: (item.price_level as PriceLevel) ?? "retail",
            lineDiscountPct: item.line_discount_pct,
            lineDiscount: item.line_discount,
          })),
          shopFor(fixture),
          fixture.input.discount,
        );

        return true;
      } catch {
        return false;
      }
    });

    expect(priced).toHaveLength(FIXTURES.carts.length);
  });
});
