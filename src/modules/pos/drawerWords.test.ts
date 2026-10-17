import { describe, expect, it } from "vitest";

import { chainLabel, movementName, refundsWord, salesSteps } from "./drawerWords";

/** B20: the drawer's sum names what its cash in and out actually were. */
describe("the cash in and cash out lines", () => {
  it("name the kinds of movement this shift had, one fixed order", () => {
    const shift = [
      { type: "khata_in", direction: "in" },
      { type: "paid_out", direction: "out" },
      { type: "float_add", direction: "in" },
      { type: "khata_in", direction: "in" },
      { type: "no_sale", direction: "none" },
      { type: "drop", direction: "out" },
    ];

    expect(chainLabel(shift, "in")).toBe("Cash in (Float added, Khata received)");
    expect(chainLabel(shift, "out")).toBe("Cash out (Paid out, Safe drop)");
    expect(chainLabel([...shift].reverse(), "in"), "whichever way the list arrives").toBe("Cash in (Float added, Khata received)");
  });

  it("say no more than the figure when nothing moved that way", () => {
    expect(chainLabel([{ type: "khata_in", direction: "in" }], "out")).toBe("Cash out");
  });

  it("name a type this build does not know rather than hide it", () => {
    expect(movementName("tip_out")).toBe("Tip out");
  });
});

/** B21: a swap is said as a swap — the sum is the server's, unchanged. */
describe("an exchange in the drawer", () => {
  const drawer = { cash_tendered: 5900, change_given: 1150, cash_refunds: 0 };

  it("names the cash handed back on a swap apart from change", () => {
    const steps = salesSteps({ ...drawer, exchange_cash_back: 1100 });

    expect(steps.map((s) => `${s.sign} ${s.label} ${s.value}`)).toEqual([
      "+ Cash tendered 5900",
      "− Change given 50",
      "− Handed back on exchanges 1100",
      "− Cash refunds 0",
    ]);
    expect(steps.reduce((t, s) => (s.sign === "+" ? t + s.value : t - s.value), 0), "the same cash sales").toBe(5900 - 1150);
  });

  it("says nothing of exchanges on a shift with none, or from an older server", () => {
    expect(salesSteps({ ...drawer, exchange_cash_back: 0 }).map((s) => s.label)).toEqual(["Cash tendered", "Change given", "Cash refunds"]);
    expect(salesSteps(drawer)[1].value).toBe(1150);
  });

  it("counts swaps beside refunds, not inside them", () => {
    expect(refundsWord(1, 2)).toBe("1 · 2 exchanges");
    expect(refundsWord(0, 1)).toBe("0 · 1 exchange");
    expect(refundsWord(3)).toBe("3");
  });
});
