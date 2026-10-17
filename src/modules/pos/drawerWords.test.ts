import { describe, expect, it } from "vitest";

import { chainLabel, movementName } from "./drawerWords";

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
