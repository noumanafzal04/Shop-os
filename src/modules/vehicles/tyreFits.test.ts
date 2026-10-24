import { describe, expect, it } from "vitest";
import { fitsTyreSize } from "./tyreFits";

/** The car takes 195/65 R15: the till offers what fits, however the shop wrote it. */
describe("what fits the car on the ramp", () => {
  it("finds the size written any way, and not its neighbours", () => {
    for (const name of ["Yokohama 195/65 R15", "195/65R15 Dunlop", "Tyre 195 65 15"]) expect(fitsTyreSize(name, "195/65 R15")).toBe(true);
    for (const name of ["General 185/65 R15", "Bridgestone 195/55 R16", "Wiper blade"]) expect(fitsTyreSize(name, "195/65 R15")).toBe(false);
  });

  it("narrows nothing for text that is no size", () => {
    expect(fitsTyreSize("Wiper blade", "")).toBe(true);
    expect(fitsTyreSize("Wiper blade", "big")).toBe(true);
  });
});
