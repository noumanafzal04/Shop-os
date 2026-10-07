import { describe, expect, it } from "vitest";
import { checkNumbers, needsDetails, parseSerials } from "./receive";

describe("the numbers written down when goods arrive", () => {
  it("reads one number per line, or per comma, and ignores the gaps", () => {
    expect(parseSerials(" A1 \n\nB2,  C3 ,\n")).toEqual(["A1", "B2", "C3"]);
  });

  it("five numbers for five boxes can be sent", () => {
    expect(checkNumbers("A\nB\nC\nD\nE", 5)).toEqual({ count: 5, tooMany: false, repeated: null, unnumbered: 0, ok: true });
  });

  it("six numbers for five boxes cannot", () => {
    const six = checkNumbers("A\nB\nC\nD\nE\nF", 5);
    expect(six.tooMany).toBe(true);
    expect(six.ok).toBe(false);
    // Nothing is "unnumbered" when there are too many: one fault is said, not two.
    expect(six.unnumbered).toBe(0);
  });

  it("names the number that was scanned twice", () => {
    const twice = checkNumbers("A\nB\nA\nB", 5);
    expect(twice.repeated).toBe("A");
    expect(twice.ok).toBe(false);
  });

  it("three numbers for five boxes can be sent — and says two will have none", () => {
    const short = checkNumbers("A\nB\nC", 5);
    expect(short.ok).toBe(true);
    expect(short.unnumbered).toBe(2);
  });

  it("none at all is every box unnumbered", () => {
    expect(checkNumbers("", 5)).toMatchObject({ count: 0, unnumbered: 5, ok: true });
  });

  it("a quantity that is not a number is no boxes", () => {
    expect(checkNumbers("A", Number.NaN)).toMatchObject({ tooMany: true, ok: false });
    expect(checkNumbers("", Number.NaN)).toMatchObject({ unnumbered: 0, ok: true });
  });
});

describe("an order that has to be received on the sheet that asks", () => {
  const line = (over: object = {}) => ({ quantity_ordered: 5, quantity_received: 0, product: { tracks_serial: false, item_type: "physical_product" }, ...over });

  it("is not one of plain goods", () => {
    expect(needsDetails([line(), line()])).toBe(false);
  });

  it("is one with a phone still to arrive", () => {
    expect(needsDetails([line(), line({ product: { tracks_serial: true, item_type: "physical_product" } })])).toBe(true);
  });

  it("is one with a medicine still to arrive", () => {
    expect(needsDetails([line({ product: { tracks_serial: false, item_type: "medicine" } })])).toBe(true);
  });

  it("is not one whose phones have all arrived", () => {
    expect(needsDetails([line({ quantity_ordered: "5.000", quantity_received: "5.000", product: { tracks_serial: true, item_type: "physical_product" } }), line()])).toBe(false);
  });

  it("is not one whose product is gone", () => {
    expect(needsDetails([line({ product: null })])).toBe(false);
  });
});
