import { describe, expect, it } from "vitest";

import { bestPromotion, liveNow, unsupportedPromotions } from "./bestPromotion";
import type { PromoLine } from "./bestPromotion";
import type { CatalogPromotion } from "../sync/catalogService";

/**
 * The automatic promotion, decided with no server.
 *
 * Written after the first real shadow run, which produced nine disagreements —
 * every one of them a shop's "Weekend 10% Off" that the server applied and the
 * till did not. Nobody was mis-billed, because the customer pays the server's
 * price. A till allowed to sell offline would have printed a receipt ten per
 * cent too high on every sale of the day.
 *
 * Every rule below is `PromotionService`'s, mirrored. Where the two could
 * differ they must not.
 */

const promo = (over: Partial<CatalogPromotion> = {}): CatalogPromotion => ({
  id: "p1",
  name: "Weekend 10% Off",
  is_active: true,
  type: "percent",
  value: 10,
  scope: "order",
  category_id: null,
  product_ids: null,
  min_spend: null,
  min_qty: null,
  max_discount: null,
  starts_on: null,
  ends_on: null,
  days_of_week: null,
  start_time: null,
  end_time: null,
  priority: 0,
  buy_qty: null,
  get_qty: null,
  get_discount_pct: null,
  ...over,
});

const line = (over: Partial<PromoLine> = {}): PromoLine => ({
  productId: "prod-1",
  categoryId: "cat-1",
  quantity: 1,
  lineTotal: 1000,
  ...over,
});

/** A Tuesday, 14:00 in Karachi (09:00 UTC). */
const TUESDAY_2PM = new Date("2026-08-11T09:00:00Z");
const KARACHI = "Asia/Karachi";

const best = (promos: CatalogPromotion[], lines: PromoLine[], subtotal: number, at = TUESDAY_2PM) =>
  bestPromotion(promos, lines, subtotal, at, KARACHI);

describe("what a promotion is worth", () => {
  it("takes a percentage off the whole order", () => {
    // The exact case the shadow check found: Rs 1,060 cart, 10% off, Rs 106.
    expect(best([promo()], [line({ lineTotal: 1060 })], 1060)?.discount).toBe(106);
  });

  it("caps a percentage at max_discount", () => {
    const capped = promo({ value: 50, max_discount: 100 });

    expect(best([capped], [line()], 1000)?.discount).toBe(100);
  });

  it("takes a flat amount off", () => {
    expect(best([promo({ type: "fixed", value: 250 })], [line()], 1000)?.discount).toBe(250);
  });

  it("never discounts more than the base it applies to", () => {
    // A Rs 500 fixed promotion on a Rs 200 cart is Rs 200, not a refund.
    expect(best([promo({ type: "fixed", value: 500 })], [line({ lineTotal: 200 })], 200)?.discount)
      .toBe(200);
  });

  it("refuses an order promotion under its minimum spend", () => {
    const withMin = promo({ min_spend: 2000 });

    expect(best([withMin], [line()], 1000)).toBeNull();
    expect(best([withMin], [line({ lineTotal: 2000 })], 2000)).not.toBeNull();
  });
});

describe("scope", () => {
  it("applies a category promotion to the matching lines only", () => {
    const catPromo = promo({ scope: "category", category_id: "cat-1", value: 10 });
    const lines = [
      line({ productId: "a", categoryId: "cat-1", lineTotal: 1000 }),
      line({ productId: "b", categoryId: "cat-2", lineTotal: 500 }),
    ];

    // 10% of the matching Rs 1,000 — not of the Rs 1,500 cart.
    expect(best([catPromo], lines, 1500)?.discount).toBe(100);
  });

  it("applies a product promotion to the named products only", () => {
    const prodPromo = promo({ scope: "product", product_ids: ["a"], value: 10 });
    const lines = [
      line({ productId: "a", lineTotal: 1000 }),
      line({ productId: "b", lineTotal: 500 }),
    ];

    expect(best([prodPromo], lines, 1500)?.discount).toBe(100);
  });

  it("does not apply when nothing in the cart matches", () => {
    const catPromo = promo({ scope: "category", category_id: "cat-9" });

    expect(best([catPromo], [line()], 1000)).toBeNull();
  });

  it("refuses a scoped promotion under its minimum quantity", () => {
    const withMin = promo({ scope: "category", category_id: "cat-1", min_qty: 3 });

    expect(best([withMin], [line({ quantity: 2 })], 1000)).toBeNull();
    expect(best([withMin], [line({ quantity: 3 })], 1000)).not.toBeNull();
  });
});

describe("buy X get Y", () => {
  const bogo = (over: Partial<CatalogPromotion> = {}) =>
    promo({ type: "bogo", scope: "order", buy_qty: 1, get_qty: 1, ...over });

  it("gives the CHEAPEST unit away, not the dearest", () => {
    // Buy 1 get 1 across two units: one group, one free, and the shop gives
    // away the cheaper of them.
    const lines = [
      line({ productId: "a", quantity: 1, lineTotal: 300 }),
      line({ productId: "b", quantity: 1, lineTotal: 100 }),
    ];

    expect(best([bogo()], lines, 400)?.discount).toBe(100);
  });

  it("gives nothing away until a whole group is in the cart", () => {
    expect(best([bogo()], [line({ quantity: 1, lineTotal: 300 })], 300)).toBeNull();
  });

  it("honours a partial discount on the free unit", () => {
    // 50 means half off, not free.
    const lines = [
      line({ productId: "a", quantity: 1, lineTotal: 300 }),
      line({ productId: "b", quantity: 1, lineTotal: 100 }),
    ];

    expect(best([bogo({ get_discount_pct: 50 })], lines, 400)?.discount).toBe(50);
  });

  it("counts WHOLE units only, so a weighed line cannot buy a free one", () => {
    // 1.5kg of something is one whole unit, not two. Counting the fraction
    // would hand out a free unit the customer never bought.
    const lines = [
      line({ productId: "a", quantity: 1.5, lineTotal: 300 }),
      line({ productId: "b", quantity: 0.5, lineTotal: 100 }),
    ];

    expect(best([bogo()], lines, 400)).toBeNull();
  });

  it("prices the free unit at the line's EFFECTIVE rate", () => {
    // The line already has a per-line discount inside `lineTotal`, so dividing
    // by quantity is what stops the promotion discounting it a second time.
    const lines = [line({ quantity: 2, lineTotal: 100 })];

    // Two units at Rs 50 each; one group, one free unit at Rs 50.
    expect(best([bogo()], lines, 100)?.discount).toBe(50);
  });
});

describe("is it live", () => {
  it("ignores a promotion that has been switched off", () => {
    // The shop turned it off. Applying it offline would discount every cart
    // against the owner's own decision.
    expect(liveNow(promo({ is_active: false }), TUESDAY_2PM, KARACHI)).toBe(false);
    expect(best([promo({ is_active: false })], [line()], 1000)).toBeNull();
  });

  it("respects the start and end dates", () => {
    expect(liveNow(promo({ starts_on: "2026-08-12" }), TUESDAY_2PM, KARACHI)).toBe(false);
    expect(liveNow(promo({ ends_on: "2026-08-10" }), TUESDAY_2PM, KARACHI)).toBe(false);
    expect(liveNow(promo({ starts_on: "2026-08-11", ends_on: "2026-08-11" }), TUESDAY_2PM, KARACHI))
      .toBe(true);
  });

  it("respects days of the week, read in the SHOP's timezone", () => {
    // 2 is Tuesday, following Carbon's 0 = Sunday.
    expect(liveNow(promo({ days_of_week: [2] }), TUESDAY_2PM, KARACHI)).toBe(true);
    expect(liveNow(promo({ days_of_week: [5, 6] }), TUESDAY_2PM, KARACHI)).toBe(false);
  });

  it("respects a time window", () => {
    const evening = promo({ start_time: "18:00", end_time: "21:00" });

    // 14:00 Karachi is outside it.
    expect(liveNow(evening, TUESDAY_2PM, KARACHI)).toBe(false);
    // 19:00 Karachi is 14:00 UTC.
    expect(liveNow(evening, new Date("2026-08-11T14:00:00Z"), KARACHI)).toBe(true);
  });

  it("handles a window that wraps midnight", () => {
    const lateNight = promo({ start_time: "22:00", end_time: "02:00" });

    // 23:00 Karachi = 18:00 UTC. 01:00 Karachi = 20:00 UTC the day before.
    expect(liveNow(lateNight, new Date("2026-08-11T18:00:00Z"), KARACHI)).toBe(true);
    expect(liveNow(lateNight, new Date("2026-08-10T20:00:00Z"), KARACHI)).toBe(true);
    expect(liveNow(lateNight, TUESDAY_2PM, KARACHI)).toBe(false);
  });

  it("reads the calendar in the shop's zone and not in UTC", () => {
    // 20:00 UTC on Tuesday is 01:00 WEDNESDAY in Karachi. A till judging this
    // in UTC would run Tuesday's promotion into Wednesday's small hours.
    const lateTuesdayUtc = new Date("2026-08-11T20:00:00Z");

    expect(liveNow(promo({ days_of_week: [2] }), lateTuesdayUtc, KARACHI)).toBe(false);
    expect(liveNow(promo({ days_of_week: [3] }), lateTuesdayUtc, KARACHI)).toBe(true);
  });
});

describe("choosing between them", () => {
  it("takes the largest discount", () => {
    const small = promo({ id: "small", value: 5 });
    const large = promo({ id: "large", value: 20 });

    expect(best([small, large], [line()], 1000)?.id).toBe("large");
  });

  it("breaks a tie on priority", () => {
    const low = promo({ id: "low", value: 10, priority: 1 });
    const high = promo({ id: "high", value: 10, priority: 5 });

    expect(best([low, high], [line()], 1000)?.id).toBe("high");
  });

  it("returns nothing when none of them apply", () => {
    expect(best([promo({ min_spend: 9999 })], [line()], 1000)).toBeNull();
    expect(best([], [line()], 1000)).toBeNull();
  });
});

describe("what this engine will not attempt", () => {
  // The safety net, and it matters more than the engine itself. A promotion
  // the mirror does not understand is not a smaller discount — it is a receipt
  // that is wrong on every cart the promotion touches, found by a customer
  // with no way to check.

  it("names a live promotion of a type it cannot evaluate", () => {
    const exotic = promo({ type: "tiered-mystery" });

    expect(unsupportedPromotions([exotic], TUESDAY_2PM, KARACHI)).toHaveLength(1);
  });

  it("says nothing about the types it CAN do", () => {
    const known = [promo({ type: "percent" }), promo({ type: "fixed" }), promo({ type: "bogo" })];

    expect(unsupportedPromotions(known, TUESDAY_2PM, KARACHI)).toEqual([]);
  });

  it("ignores an unknown type that is not live", () => {
    // Refusing a shop over a promotion switched off since March is a refusal
    // with no risk behind it, and a gate that cries wolf gets turned off.
    const off = promo({ type: "tiered-mystery", is_active: false });
    const expired = promo({ type: "tiered-mystery", ends_on: "2026-01-01" });

    expect(unsupportedPromotions([off, expired], TUESDAY_2PM, KARACHI)).toEqual([]);
  });
});
