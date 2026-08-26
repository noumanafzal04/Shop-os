import { describe, expect, it } from "vitest";

import { formatMoney } from "./money";

describe("money reads like money", () => {
  it("leaves a whole amount whole", () => {
    // A column of ".00" is noise on every line to make one line line up.
    expect(formatMoney("Rs", 4000)).toBe("Rs 4,000");
    expect(formatMoney("Rs", "4000")).toBe("Rs 4,000");
    expect(formatMoney("Rs", 0)).toBe("Rs 0");
  });

  it("writes half a rupee as .50, never .5", () => {
    // This is the defect: toLocaleString's default is three places with the
    // trailing zeroes dropped, so a cashbook said "Rs 2,350,196.5".
    expect(formatMoney("Rs", 2350196.5)).toBe("Rs 2,350,196.50");
    expect(formatMoney("Rs", 187374.5)).toBe("Rs 187,374.50");
  });

  it("never shows a third decimal place", () => {
    expect(formatMoney("Rs", 1234.567)).toBe("Rs 1,234.57");
    expect(formatMoney("Rs", 0.005)).toBe("Rs 0.01");
  });

  it("does not put .00 on an amount that only rounds to whole", () => {
    expect(formatMoney("Rs", 4000.0001)).toBe("Rs 4,000");
  });

  it("keeps a negative readable", () => {
    expect(formatMoney("Rs", -71791)).toBe("Rs -71,791");
    expect(formatMoney("Rs", -13985.5)).toBe("Rs -13,985.50");
  });

  it("answers with the shop's own symbol", () => {
    expect(formatMoney("$", 12)).toBe("$ 12");
    expect(formatMoney("AED", 12.5)).toBe("AED 12.50");
  });

  it("does not print NaN at a merchant", () => {
    expect(formatMoney("Rs", "")).toBe("Rs 0");
    expect(formatMoney("Rs", "not a number")).toBe("Rs 0");
  });
});
