import { describe, expect, it } from "vitest";

import fixture from "./fixtures/currency-format.json";
import { PKR, currencyOf, formatIn, numberIn, paperIn, platformMoney, type CurrencyFormat } from "./currency";

/**
 * THE PANEL WRITES MONEY THE WAY THE SERVER DOES.
 *
 * The strings in the fixture are made by the server's own list
 * (`CurrencyFormatFixturesTest`). Every currency a shop may choose, at the
 * amounts where the rules bite: wholes, fractions, lakhs, crores, below zero.
 */

const byCode = Object.fromEntries((fixture.currencies as CurrencyFormat[]).map((c) => [c.code, c]));

describe("every currency, written as the server writes it", () => {
  it("the fixture holds the three that were asked for", () => {
    expect(Object.keys(byCode)).toEqual(expect.arrayContaining(["PKR", "USD", "INR"]));
    expect(fixture.cases.length).toBeGreaterThan(100);
  });

  for (const c of fixture.cases) {
    it(`${c.code} ${c.amount} → ${c.screen}`, () => {
      const currency = byCode[c.code];

      expect(formatIn(currency, c.amount)).toBe(c.screen);
      expect(paperIn(currency, c.amount)).toBe(c.paper);
      expect(numberIn(currency, c.amount)).toBe(c.number);
      // …and a figure that arrives as text, as every decimal column does.
      expect(formatIn(currency, String(c.amount))).toBe(c.screen);
    });
  }
});

describe("before a shop's settings have loaded", () => {
  it("the default is the server's default, field for field", () => {
    expect(fixture.default).toBe("PKR");
    expect(PKR).toEqual(byCode.PKR);
  });

  it("nothing sent, or something that is not a format, is the default", () => {
    expect(currencyOf(undefined)).toEqual(PKR);
    expect(currencyOf(null)).toEqual(PKR);
    expect(currencyOf("USD")).toEqual(PKR);
    expect(currencyOf({ code: "USD" })).toEqual(PKR);
    expect(formatIn(undefined, 4000)).toBe("Rs 4,000");
  });

  it("what the server sent is used as sent", () => {
    expect(currencyOf(byCode.INR)).toEqual(byCode.INR);
    expect(formatIn(currencyOf(byCode.USD), 12)).toBe("$12.00");
  });
});

describe("the same figure in three shops", () => {
  it("is three different pieces of writing", () => {
    expect(formatIn(byCode.PKR, 1234567)).toBe("Rs 1,234,567");
    expect(formatIn(byCode.INR, 1234567)).toBe("₹12,34,567");
    expect(formatIn(byCode.USD, 1234567)).toBe("$1,234,567.00");
  });

  it("does not print NaN at a merchant", () => {
    expect(formatIn(byCode.USD, "")).toBe("$0.00");
    expect(formatIn(byCode.INR, "abc")).toBe("₹0");
    expect(formatIn(byCode.PKR, null)).toBe("Rs 0");
  });

  it("does not depend on the language the browser is set to", () => {
    // `toLocaleString(undefined)` wrote 2.350.196,50 in a German browser.
    const was = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = () => "LOCALE";
    try {
      expect(formatIn(byCode.PKR, 2350196.5)).toBe("Rs 2,350,196.50");
    } finally {
      Number.prototype.toLocaleString = was;
    }
  });
});

/**
 * The rupee's own rules — what `formatMoney` held before a shop could trade
 * in anything else, and the defects it was written for. Kept as cases of
 * their own: the fixture proves the panel agrees with the server, and these
 * say WHY the rule is what it is.
 */
describe("rupees read like money", () => {
  const rs = (n: string | number) => formatIn(PKR, n);

  it("leaves a whole amount whole", () => {
    // A column of ".00" is noise on every line to make one line line up.
    expect(rs(4000)).toBe("Rs 4,000");
    expect(rs("4000")).toBe("Rs 4,000");
    expect(rs(0)).toBe("Rs 0");
  });

  it("writes half a rupee as .50, never .5", () => {
    // The defect: toLocaleString's default is three places with the trailing
    // zeroes dropped, so a cashbook said "Rs 2,350,196.5".
    expect(rs(2350196.5)).toBe("Rs 2,350,196.50");
    expect(rs(187374.5)).toBe("Rs 187,374.50");
  });

  it("never shows a third decimal place", () => {
    expect(rs(1234.567)).toBe("Rs 1,234.57");
    expect(rs(0.005)).toBe("Rs 0.01");
  });

  it("does not put .00 on an amount that only rounds to whole", () => {
    expect(rs(4000.0001)).toBe("Rs 4,000");
  });

  it("keeps a negative readable", () => {
    expect(rs(-71791)).toBe("Rs -71,791");
    expect(rs(-13985.5)).toBe("Rs -13,985.50");
  });

  it("does not print NaN at a merchant", () => {
    expect(rs("")).toBe("Rs 0");
    expect(rs("not a number")).toBe("Rs 0");
  });
});

describe("what the platform charges", () => {
  it("is in the platform's money whatever the shop trades in", () => {
    expect(platformMoney(3000)).toBe("Rs 3,000");
    expect(platformMoney(25000.5)).toBe("Rs 25,000.50");
  });
});
