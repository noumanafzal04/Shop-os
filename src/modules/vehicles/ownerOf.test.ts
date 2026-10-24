import { describe, expect, it } from "vitest";
import { ownerOf } from "./ownerOf";

/** The till asked again for the name and number of a car whose owner was on file. */
describe("what a chosen plate fills in", () => {
  const car = { customer: { id: "c1", name: "Ali Raza", phone: "03001234567" } };

  it("fills the owner into empty boxes", () => {
    expect(ownerOf(car, "", "  ")).toEqual({ name: "Ali Raza", phone: "03001234567" });
  });

  it("never writes over what the counter typed — the payer is not always the owner", () => {
    expect(ownerOf(car, "Bilal", "")).toEqual({ name: null, phone: "03001234567" });
    expect(ownerOf(car, "Bilal", "0333")).toEqual({ name: null, phone: null });
  });

  it("fills nothing for a car with no owner on file", () => {
    expect(ownerOf({ customer: null }, "", "")).toEqual({ name: null, phone: null });
  });
});
