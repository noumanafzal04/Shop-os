import { describe, expect, it } from "vitest";

import { paperLabel } from "./services/receiptService";

/**
 * A shop picks "Thermal 80mm" in Settings, rings a sale, and the till says
 * nothing about paper — so the only way to confirm the choice took hold was to
 * print one and look at it. The lane's own printer legitimately overrides the
 * shop default too, which means the Settings screen could not have answered it
 * either: the honest answer is per-lane and only the server knows it.
 *
 * This is the wording half. The resolution stays server-side, on the same
 * response as the receipt, so the label can never describe a different page
 * from the one that was rendered.
 */
describe("the paper a receipt came out on, in a cashier's words", () => {
  it("names the two rolls by their width", () => {
    expect(paperLabel("thermal_80")).toBe("80mm roll");
    expect(paperLabel("thermal_58")).toBe("58mm roll");
  });

  it("calls a sheet a sheet", () => {
    // "standard" is the column's word, not a shopkeeper's.
    expect(paperLabel("standard")).toBe("A4 / Letter");
  });

  it("says nothing at all when the header was stripped", () => {
    // A proxy that drops the header costs us the label and nothing else — a
    // guess printed with confidence would be worse than silence.
    expect(paperLabel(null)).toBeNull();
  });
});
