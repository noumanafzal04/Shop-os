import { describe, expect, it } from "vitest";

import { formatQuantity, formatQuantityWithUnit } from "./quantity";

describe("formatQuantity", () => {
  it("drops the trailing zeroes a decimal column stores", () => {
    // The whole reason this exists: an order card printing the raw string
    // reads "1.000× Ghee" beside a column of money.
    expect(formatQuantity("1.000")).toBe("1");
    expect(formatQuantity("12.000")).toBe("12");
  });

  it("keeps the decimals that mean something", () => {
    expect(formatQuantity("2.500")).toBe("2.5");
    expect(formatQuantity("0.250")).toBe("0.25");
    expect(formatQuantity(1.125)).toBe("1.125");
  });

  it("rounds float noise away instead of printing it", () => {
    // The case the two older copies disagreed on. String(Number(0.1 + 0.2))
    // is "0.30000000000000004", and it reaches a screen the moment any
    // quantity is summed.
    expect(formatQuantity(0.1 + 0.2)).toBe("0.3");
    expect(formatQuantity(0.1 * 3)).toBe("0.3");
  });

  it("does not turn a missing quantity into a confident zero", () => {
    // A blank can be checked. A "0" on a picking list sends somebody away
    // with nothing and no reason to ask.
    expect(formatQuantity("")).toBe("—");
    expect(formatQuantity("abc")).toBe("—");
    expect(formatQuantity(Number.NaN)).toBe("—");
  });

  it("prints a real zero as zero", () => {
    // Distinct from the case above: nothing left IS an answer.
    expect(formatQuantity(0)).toBe("0");
    expect(formatQuantity("0.000")).toBe("0");
  });
});

describe("formatQuantityWithUnit", () => {
  it("names the unit only where the shop sells by weight", () => {
    expect(formatQuantityWithUnit("2.500", "weight", "kg")).toBe("2.5 kg");
    // Three tins is three tins. "3 kg" would be a different order.
    expect(formatQuantityWithUnit("3.000", "each", "kg")).toBe("3");
    expect(formatQuantityWithUnit("2.500", "weight", null)).toBe("2.5");
  });
});
