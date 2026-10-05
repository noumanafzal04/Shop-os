import { describe, expect, it } from "vitest";
import { priceCart, effectiveTaxRate, taxOnLines, type CartLine as EngineLine } from "../offline/pricing/priceCart";
import { round2 } from "../offline/pricing/money";
import { cartSubtotal, lineDiscountAmt, lineGross, lineNet, lineUnit, packPrice, recalcLine, type LineForMath } from "./lineMath";

/**
 * THE COUNTER'S ARITHMETIC AGREES WITH THE ENGINE — and so with the server.
 *
 * The pricing engine in `offline/pricing` is held to the real endpoint by
 * golden fixtures. It was right all along. The counter screen did not use it:
 * it had its own six functions, inline, untested, and they had drifted — by a
 * paisa on weighed goods, and by whole rupees on tiers and wholesale.
 *
 * So the claim here is not "these functions return the numbers I expect". It
 * is that for ANY cart the screen can build, the screen's total and the
 * engine's total are the same number. The named cases below are the drifts
 * that were found; the sweep at the bottom is the denominator.
 */

/** A page line, and the same line as the engine wants it described. */
interface Shape {
  price: number;
  discountPrice?: number | null;
  wholesale?: number | null;
  tiers?: Array<{ min_qty: number; price: number }> | null;
  quantity: number;
  level?: "retail" | "wholesale";
  discountValue?: number;
  discountMode?: "pct" | "amt";
  amountAsked?: number;
  taxRate?: number | null;
  groupRate?: number | null;
}

const selling = (s: Shape) =>
  s.discountPrice != null && s.discountPrice > 0 && s.discountPrice < s.price ? s.discountPrice : s.price;

/** What `addLine` + `recalcLine` leave in the cart for this product. */
function pageLine(s: Shape): LineForMath & { tax_rate: number | null; tax_group_rate: number | null } {
  const base = selling(s);
  const line = {
    unit_price: base,
    base_price: base,
    quantity: s.quantity,
    wholesale_price: s.wholesale ?? null,
    price_tiers: s.tiers ?? null,
    price_level: "retail" as "retail" | "wholesale",
    discountValue: s.discountValue,
    discountMode: s.discountMode,
    amountAsked: s.amountAsked,
    tax_rate: s.taxRate ?? null,
    tax_group_rate: s.groupRate ?? null,
  };

  // Switching the level goes through `recalcLine`, exactly as the screen does.
  return s.level === "wholesale" ? recalcLine(line, { price_level: "wholesale" }) : line;
}

function engineLine(s: Shape): EngineLine {
  return {
    item: {
      price: s.price,
      discount_price: s.discountPrice ?? null,
      wholesale_price: s.wholesale ?? null,
      price_tiers: s.tiers ?? null,
      tax_rate: s.taxRate ?? null,
      tax_group_rate: s.groupRate ?? null,
    },
    quantity: s.quantity,
    priceLevel: s.level ?? "retail",
    lineDiscountPct: s.discountMode === "pct" ? s.discountValue : null,
    lineDiscount: s.discountMode === "amt" ? s.discountValue : null,
    amountAsked: s.amountAsked ?? null,
  };
}

/** The screen's total for a cart, computed the way `PosPage` computes it. */
function pageTotal(shapes: Shape[], shop: { default_tax_rate: number; tax_inclusive: boolean }, keyed = 0) {
  const lines = shapes.map(pageLine);
  const subtotal = cartSubtotal(lines);
  const taxableBase = Math.max(0, round2(subtotal - Math.min(round2(keyed), subtotal)));
  const tax = taxOnLines(
    lines.map((l) => ({ line_total: lineNet(l), tax_rate: effectiveTaxRate(l, shop.default_tax_rate) })),
    subtotal, taxableBase, shop.tax_inclusive,
  );

  return { subtotal, tax, total: shop.tax_inclusive ? taxableBase : round2(taxableBase + tax) };
}

const EXCLUSIVE = { default_tax_rate: 0, tax_inclusive: false };

function agree(shapes: Shape[], shop = EXCLUSIVE, keyed = 0) {
  const page = pageTotal(shapes, shop, keyed);
  const engine = priceCart(shapes.map(engineLine), shop, keyed);

  expect({ subtotal: page.subtotal, tax: page.tax, total: page.total }).toEqual({
    subtotal: engine.subtotal,
    tax: engine.tax,
    total: engine.total,
  });

  return page;
}

describe("the paisa — weighed goods on an exact tender", () => {
  it("rounds each line as the server does, not the sum", () => {
    /**
     * 0.275 kg at Rs 1,235/kg is 339.625.
     *
     *   the server    339.63 + 339.63           = 679.26
     *   the old till  339.625 + 339.625 → round = 679.25
     *
     * A cash tender never sees it. A card has no change, so the sale was
     * refused for being 0.01 short.
     */
    const shape = { price: 1235, quantity: 0.275 };
    expect(lineGross(pageLine(shape))).toBe(339.63);

    const page = agree([shape, shape]);
    expect(page.total).toBe(679.26);
  });

  it("rounds a percentage discount on the already-rounded gross", () => {
    // 10% off 339.63 is 33.963 → 33.96; the line is 305.67.
    const line = pageLine({ price: 1235, quantity: 0.275, discountValue: 10, discountMode: "pct" });
    expect(lineDiscountAmt(line)).toBe(33.96);
    expect(lineNet(line)).toBe(305.67);
  });

  it("uses PHP's rounding, not JavaScript's", () => {
    // 1.005 is the classic: PHP 1.01, `Math.round(x*100)/100` 1.00.
    expect(lineGross(pageLine({ price: 1.005, quantity: 1 }))).toBe(1.01);
    agree([{ price: 1.005, quantity: 1 }, { price: 1.015, quantity: 1 }, { price: 0.145, quantity: 1 }]);
  });

  it("takes named money as the gross rather than recomputing it", () => {
    // Rs 2,000 of petrol at 268.50/L is 7.449 L — and 7.449 × 268.50 is
    // 2,000.06. The customer handed over two thousand.
    const page = agree([{ price: 268.5, quantity: 7.449, amountAsked: 2000 }]);
    expect(page.subtotal).toBe(2000);
  });
});

describe("the rupees — tiers and wholesale", () => {
  const tiers = [{ min_qty: 10, price: 90 }, { min_qty: 50, price: 85 }];

  it("charges the CHEAPEST tier the quantity qualifies for", () => {
    expect(lineUnit(pageLine({ price: 100, tiers, quantity: 9 }))).toBe(100);
    expect(lineUnit(pageLine({ price: 100, tiers, quantity: 10 }))).toBe(90);
    expect(lineUnit(pageLine({ price: 100, tiers, quantity: 50 }))).toBe(85);
    agree([{ price: 100, tiers, quantity: 50 }]);
  });

  it("is not fooled by a deeper tier priced HIGHER — legacy data", () => {
    // The old rule took the deepest `min_qty` reached: 95. The server takes
    // the cheapest: 90. Five rupees a unit the customer was asked for and
    // the sale never recorded.
    const odd = [{ min_qty: 10, price: 90 }, { min_qty: 50, price: 95 }];
    expect(lineUnit(pageLine({ price: 100, tiers: odd, quantity: 60 }))).toBe(90);
    agree([{ price: 100, tiers: odd, quantity: 60 }]);
  });

  it("never lets a tier exceed the selling price — a flash sale under the tier", () => {
    // On sale at 80 with a "10+ at 90" tier. The server charges 80.
    const shape = { price: 100, discountPrice: 80, tiers: [{ min_qty: 10, price: 90 }], quantity: 12 };
    expect(lineUnit(pageLine(shape))).toBe(80);
    agree([shape]);
  });

  it("gives a wholesale buyer the tier when the tier is cheaper", () => {
    // Wholesale 95, tier "50+ at 85", fifty bought: min of the two.
    const shape = { price: 100, wholesale: 95, tiers, quantity: 50, level: "wholesale" as const };
    expect(lineUnit(pageLine(shape))).toBe(85);
    agree([shape]);
  });

  it("gives a wholesale buyer the wholesale price when THAT is cheaper", () => {
    const shape = { price: 100, wholesale: 80, tiers, quantity: 50, level: "wholesale" as const };
    expect(lineUnit(pageLine(shape))).toBe(80);
    agree([shape]);
  });

  it("never charges wholesale ABOVE retail", () => {
    // A wholesale price over the shelf price is a data-entry mistake, and
    // the customer does not pay for it.
    const shape = { price: 100, wholesale: 120, quantity: 1, level: "wholesale" as const };
    expect(lineUnit(pageLine(shape))).toBe(100);
    agree([shape]);
  });

  it("falls back to tiered retail when the item has no wholesale price", () => {
    const shape = { price: 100, wholesale: null, tiers, quantity: 10, level: "wholesale" as const };
    expect(lineUnit(pageLine(shape))).toBe(90);
    agree([shape]);
  });
});

describe("a SIZE is priced as the size, not as the product it belongs to", () => {
  it("reads the line's own price at retail", () => {
    /**
     * `addLine` stores the SIZE's price in `unit_price` and the PARENT's in
     * `base_price`. A first rewrite of `lineUnit` read `base_price` for
     * everything and would have charged a Large at the Small's price — this
     * case is why it does not.
     */
    const large: LineForMath = { unit_price: 1400, base_price: 1000, quantity: 1, price_tiers: null };
    expect(lineUnit(large)).toBe(1400);
    expect(lineGross({ ...large, quantity: 2 })).toBe(2800);
  });

  it("prices a dish with extras at its own total — it has no base price at all", () => {
    const dish: LineForMath = { unit_price: 650.5, quantity: 3 };
    expect(lineUnit(dish)).toBe(650.5);
    expect(lineGross(dish)).toBe(1951.5);
  });
});

describe("a pack is priced explicitly", () => {
  const carton = { id: "u1", name: "Carton", factor: 12, price: null } as never;
  const priced = { id: "u2", name: "Box", factor: 6, price: 550 } as never;

  it("uses the pack's own price when it has one, else base × factor", () => {
    expect(packPrice(100, priced)).toBe(550);
    expect(packPrice(100, carton)).toBe(1200);
    // 8.335 × 12 is 100.02 — rounded the server's way, not truncated.
    expect(packPrice(8.335, carton)).toBe(100.02);
  });

  it("is not re-priced by a quantity tier", () => {
    const line: LineForMath = {
      unit_price: 1200, base_price: 100, quantity: 20, product_unit_id: "u1",
      price_tiers: [{ min_qty: 10, price: 90 }],
    };
    expect(lineUnit(line)).toBe(1200);
  });
});

describe("a discount can never take a line below nothing", () => {
  it("clamps a flat discount to the line", () => {
    const line = pageLine({ price: 100, quantity: 1, discountValue: 500, discountMode: "amt" });
    expect(lineDiscountAmt(line)).toBe(100);
    expect(lineNet(line)).toBe(0);
    agree([{ price: 100, quantity: 1, discountValue: 500, discountMode: "amt" }]);
  });

  it("clamps a percentage to a hundred", () => {
    const line = pageLine({ price: 100, quantity: 1, discountValue: 250, discountMode: "pct" });
    expect(lineNet(line)).toBe(0);
  });
});

describe("the denominator — every cart shape, against the engine", () => {
  /**
   * A fixed-seed sweep, so it is the same four thousand carts on every run
   * and a failure can be reproduced by its number.
   *
   * Named cases prove the drifts that were FOUND. This is what stands
   * between the screen and the ones that were not: quantities that do not
   * divide, prices with a third decimal, discounts of both kinds, every tax
   * source, both tax modes, a keyed cart discount — in combination.
   */
  let seed = 20261005;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;

    return seed / 4294967296;
  };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

  const shape = (): Shape => {
    const price = pick([10, 99.99, 100, 268.5, 1235, 8.335, 1.005, 4200, 0.145, 33.33]);
    const weighed = rand() < 0.4;
    const quantity = weighed ? pick([0.275, 0.5, 1.125, 2.333, 7.449, 0.001]) : pick([1, 2, 3, 10, 12, 50, 60]);
    const discounted = rand() < 0.35;

    return {
      price,
      discountPrice: rand() < 0.25 ? round2(price * pick([0.5, 0.8, 0.95, 1.2])) : null,
      wholesale: rand() < 0.4 ? round2(price * pick([0.7, 0.9, 1.1])) : null,
      tiers: rand() < 0.4
        ? [{ min_qty: 10, price: round2(price * pick([0.9, 0.95])) }, { min_qty: 50, price: round2(price * pick([0.85, 0.97])) }]
        : null,
      quantity,
      level: rand() < 0.3 ? "wholesale" : "retail",
      discountValue: discounted ? pick([5, 10, 12.5, 33.33, 50, 250]) : undefined,
      discountMode: discounted ? pick(["pct", "amt"] as const) : undefined,
      taxRate: pick([null, null, 0, 5, 13, 17]),
      groupRate: pick([null, null, 0, 10, 18]),
    };
  };

  it("agrees on four thousand carts", () => {
    const disagreements: string[] = [];

    for (let i = 0; i < 4000; i++) {
      const shapes = Array.from({ length: 1 + Math.floor(rand() * 6) }, shape);
      const shop = { default_tax_rate: pick([0, 0, 13, 17]), tax_inclusive: rand() < 0.3 };
      const keyed = rand() < 0.3 ? pick([10, 50, 99.99, 5000]) : 0;

      const page = pageTotal(shapes, shop, keyed);
      const engine = priceCart(shapes.map(engineLine), shop, keyed);

      if (page.subtotal !== engine.subtotal || page.tax !== engine.tax || page.total !== engine.total) {
        disagreements.push(
          `#${i}: screen ${page.subtotal}/${page.tax}/${page.total} vs engine ${engine.subtotal}/${engine.tax}/${engine.total}`,
        );
      }
    }

    // Reported by number, with both figures, so a failure is a cart somebody
    // can re-create rather than a boolean.
    expect(disagreements.slice(0, 5)).toEqual([]);
  });
});
