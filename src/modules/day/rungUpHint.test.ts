import { describe, expect, it } from "vitest";

import { bookingCashAway, rungUpHint } from "./rungUpHint";

describe("what the day's takings are made of", () => {
  it("says how many no drawer took", () => {
    expect(rungUpHint({ sales_count: 8, away_from_drawers: { sales_count: 2, sales_total: 8890 } })).toBe("8 sales · 2 not at a counter");
  });

  it("says nothing extra when every sale was at a counter", () => {
    expect(rungUpHint({ sales_count: 1, away_from_drawers: { sales_count: 0, sales_total: 0 } })).toBe("1 sale");
    expect(rungUpHint({ sales_count: 3 })).toBe("3 sales");
  });
});

/**
 * #AZ21 — a layaway's Rs 40 taken with no drawer open, and Rs 75 handed back
 * on a cancellation with none open, moved not one cash figure on Day & banking.
 */
describe("a booking's cash that no drawer took", () => {
  const money = (n: number) => String(n);

  it("is said beside the drawers, both ways", () => {
    expect(bookingCashAway({ sales_count: 0, sales_total: 0, advances_in: 40, advances_back: 75 }, money))
      .toBe("On bookings with no drawer open: 40 cash taken · 75 cash handed back. It is in your books and in no till's count — open a shift first to have it counted.");
    expect(bookingCashAway({ sales_count: 0, sales_total: 0, advances_in: 40 }, money)).toMatch(/^On bookings with no drawer open: 40 cash taken\. /);
  });

  it("says nothing when every booking's cash went through a drawer", () => {
    expect(bookingCashAway({ sales_count: 2, sales_total: 500, advances_in: 0, advances_back: 0 }, money)).toBeNull();
    expect(bookingCashAway(undefined, money)).toBeNull();
  });

  it("Day & banking says it on an open day and on a day with no drawer at all", () => {
    const page = Object.values(import.meta.glob("./pages/DayPage.tsx", { query: "?raw", import: "default", eager: true }))[0] as string;

    expect(page).toMatch(/bookingCashAway\(running!\.away_from_drawers, money\) !== null/);
    expect(page).toMatch(/bookingCashAway\(takenWithNoDrawer\.data, money\) !== null/);
  });
});
