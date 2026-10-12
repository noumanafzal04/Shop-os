import { describe, expect, it } from "vitest";

import { leftOf, whyNotOrderable } from "./whatIsLeft";

const item = (over: Record<string, unknown> = {}) =>
  ({ type: "product", track_inventory: true, stock_quantity: "0.000", variants: [], sold_out: false, ...over }) as never;

describe("what a phone order may be given of one item", () => {
  it("a dish nobody counts is never short — its figure of nought is not a shelf", () => {
    const biryani = item({ track_inventory: false, stock_quantity: "0.000" });

    expect(leftOf(biryani)).toBeNull();
    expect(whyNotOrderable(biryani), "a made-to-order dish read as none left").toBeNull();
  });

  it("a counted item shows what is on the shelf, and is out at nought", () => {
    expect(leftOf(item({ stock_quantity: "9.500" }))).toBe(9.5);
    expect(whyNotOrderable(item({ stock_quantity: "9.500" }))).toBeNull();
    expect(whyNotOrderable(item({ stock_quantity: "0.000" }))).toBe("none left");
    expect(whyNotOrderable(item({ stock_quantity: "-2.000" }))).toBe("none left");
  });

  it("a service is never short", () => {
    expect(leftOf(item({ type: "service", track_inventory: false }))).toBeNull();
    expect(whyNotOrderable(item({ type: "service", track_inventory: false }))).toBeNull();
  });

  it("an item with sizes is not judged against its own row, which is always nought", () => {
    const sized = item({ variants: [{ id: "v1" }, { id: "v2" }], stock_quantity: "0.000" });

    expect(leftOf(sized)).toBeNull();
    expect(whyNotOrderable(sized)).toBeNull();
  });

  it("a dish taken off for today is off, whatever the shelf says", () => {
    expect(whyNotOrderable(item({ track_inventory: false, sold_out: true }))).toBe("off");
    expect(whyNotOrderable(item({ stock_quantity: "12.000", sold_out: true }))).toBe("off");
  });

  it("an item that does not say whether it is counted is not counted", () => {
    // The list endpoint always says. If it ever does not, "unknown" must not
    // mean "refuse the order" — the server decides, and it knows.
    expect(whyNotOrderable(item({ track_inventory: undefined }))).toBeNull();
  });
});
