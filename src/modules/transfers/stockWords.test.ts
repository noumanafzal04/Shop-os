import { describe, expect, it } from "vitest";
import type { StockPlace } from "./services/stockByPlaceService";
import { fullestOther, isLowAt, refillLink } from "./stockWords";

const places: StockPlace[] = [
  { id: "main", name: "Main", kind: "shop", is_default: true },
  { id: "gulberg", name: "Gulberg", kind: "shop", is_default: false },
  { id: "godown", name: "Godown", kind: "warehouse", is_default: false },
];

describe("is a place running low", () => {
  it("is low at or below the level, and holding none counts as nought", () => {
    expect(isLowAt({ places: { main: 5 }, low_stock_threshold: 5 }, "main")).toBe(true);
    expect(isLowAt({ places: { main: 6 }, low_stock_threshold: 5 }, "main")).toBe(false);
    expect(isLowAt({ places: {}, low_stock_threshold: 5 }, "main")).toBe(true);
  });

  it("a product nobody set a level for is never called low", () => {
    expect(isLowAt({ places: { main: 0 }, low_stock_threshold: null }, "main")).toBe(false);
  });

  it("asks about one place — from head office there is no 'here'", () => {
    expect(isLowAt({ places: { main: 0 }, low_stock_threshold: 5 }, null)).toBe(false);
  });
});

describe("where to bring it from", () => {
  it("is the other place holding the most", () => {
    expect(fullestOther({ places: { main: 2, gulberg: 9, godown: 40 } }, places, "main")?.id).toBe("godown");
    expect(fullestOther({ places: { main: 2, gulberg: 50, godown: 40 } }, places, "main")?.id).toBe("gulberg");
  });

  it("is the warehouse before a branch when they hold the same", () => {
    expect(fullestOther({ places: { gulberg: 10, godown: 10 } }, places, "main")?.id).toBe("godown");
  });

  it("is never the place that is asking, and nowhere when nobody else has any", () => {
    expect(fullestOther({ places: { main: 99 } }, places, "main")).toBeNull();
    expect(fullestOther({ places: { main: 99, godown: 0 } }, places, "main")).toBeNull();
  });
});

describe("the link that opens a transfer already filled in", () => {
  it("carries both ends and the product, safely", () => {
    expect(refillLink("godown", "main", "Basmati 5kg & Sella")).toBe("/tenant/transfers?from=godown&to=main&product=Basmati+5kg+%26+Sella");
  });

  it("leaves the destination to be picked when the screen does not know who is asking", () => {
    expect(refillLink("godown", null, "Rice")).toBe("/tenant/transfers?from=godown&product=Rice");
  });
});
