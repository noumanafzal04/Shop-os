import { describe, expect, it } from "vitest";
import { bankedBeyondDrawers, depositCanBeCorrected, stillInTheShopHint } from "./banking";

/**
 * Next rounds #19 and #20: Rs 16,000 banked against Rs 15,403.17 in the drawers
 * was taken without a word, and a deposit typed wrong could never be put right.
 */
const day = { unbanked: 15403.17, deposits: [{ id: "d3", amount: "5000.00" }] } as never;

describe("a deposit measured against the drawers", () => {
  it("names how much more than the drawers hold it banks", () => {
    expect(bankedBeyondDrawers(16000, day)).toBe(596.83);
    expect(bankedBeyondDrawers(15403.17, day)).toBe(0);
    expect(bankedBeyondDrawers(0, day)).toBe(0);
  });

  it("frees a corrected deposit's old amount first — 1,600 over 5,000 is not more", () => {
    expect(bankedBeyondDrawers(1600, day, { id: "d3", amount: "5000.00" })).toBe(0);
    expect(bankedBeyondDrawers(20500, day, { id: "d3", amount: "5000.00" })).toBe(96.83);
    // A deposit from another day frees nothing on this one.
    expect(bankedBeyondDrawers(16000, day, { id: "old", amount: "5000.00" })).toBe(596.83);
  });

  it("asks nothing with no trading day to measure against", () => {
    expect(bankedBeyondDrawers(16000, null)).toBe(0);
  });
});

describe("a deposit that can still be corrected", () => {
  it("is one whose day is trading, or has none", () => {
    expect(depositCanBeCorrected({ business_day: { id: "a", trading_date: "2026-10-22", status: "open" } })).toBe(true);
    expect(depositCanBeCorrected({ business_day: null })).toBe(true);
    expect(depositCanBeCorrected({ business_day: { id: "a", trading_date: "2026-10-21", status: "closed" } })).toBe(false);
    expect(depositCanBeCorrected({ business_day: null }, "closed")).toBe(false);
  });
});

/**
 * #AZ7 — In the drawers 1,140 · Banked 500 · Still in the shop 5,640, under
 * "In the drawers, less what was banked": a closed shift had been counted
 * 5,000 over, and still-in-the-shop is taken from the COUNT.
 */
describe("what still-in-the-shop is taken from", () => {
  const word = (n: number) => String(n);

  it("says the plain subtraction while every count matched", () => {
    expect(stillInTheShopHint(0, word)).toBe("In the drawers, less what was banked");
  });

  it("names the count, and how far it was out, once one did not", () => {
    expect(stillInTheShopHint(5000, word)).toBe("What the drawers were counted at, less what was banked — the count was 5000 over");
    expect(stillInTheShopHint(-120.5, word)).toBe("What the drawers were counted at, less what was banked — the count was 120.5 short");
  });

  it("the Day screen reads it", () => {
    const page = Object.values(import.meta.glob("./pages/DayPage.tsx", { query: "?raw", import: "default", eager: true }))[0] as string;

    expect(page).toMatch(/stillInTheShopHint\(running!\.variance, money\)/);
  });
});
