import { describe, expect, it } from "vitest";
import { going, stockSays, unanswered, type Answers } from "./placeGoing";

const nothing: Answers = { stock: "", stockTo: "", peopleTo: "" };
const leaving = (over: Partial<{ products: number; units: number; people: number; blocked: string | null }> = {}) => ({
  products: 0, units: 0, people: 0, blocked: null, ...over,
});

describe("deleting a place that is not empty", () => {
  it("an empty place needs no answers, and sends none", () => {
    expect(unanswered(leaving(), nothing)).toBeNull();
    expect(going(leaving(), nothing)).toEqual({});
  });

  it("stock on its shelves has to be answered for before Delete is live", () => {
    const held = leaving({ products: 14, units: 320 });

    expect(unanswered(held, nothing)).toBe("Say what becomes of its stock.");
    expect(unanswered(held, { ...nothing, stock: "move" })).toBe("Choose the place its stock moves to.");
    expect(unanswered(held, { ...nothing, stock: "move", stockTo: "main" })).toBeNull();
    // Writing it off needs no destination.
    expect(unanswered(held, { ...nothing, stock: "discard" })).toBeNull();
  });

  it("people assigned to it need somewhere to work, whatever happens to the stock", () => {
    const staffed = leaving({ products: 2, units: 5, people: 3 });

    expect(unanswered(staffed, { ...nothing, stock: "discard" })).toBe("Choose where its staff will work.");
    expect(unanswered(staffed, { stock: "discard", stockTo: "", peopleTo: "main" })).toBeNull();
  });

  it("what somebody has to finish first cannot be answered away", () => {
    const blocked = leaving({ products: 2, units: 5, blocked: "A till is still open at Gulberg. Close its shift first." });

    expect(unanswered(blocked, { stock: "discard", stockTo: "", peopleTo: "" })).toBe("A till is still open at Gulberg. Close its shift first.");
  });

  it("sends only the answers that were asked for", () => {
    expect(going(leaving({ products: 1, units: 4 }), { stock: "move", stockTo: "main", peopleTo: "left-over" }))
      .toEqual({ stock: "move", stock_to: "main" });
    expect(going(leaving({ people: 2 }), { stock: "discard", stockTo: "x", peopleTo: "main" }))
      .toEqual({ people_to: "main" });
    // Written off: no destination goes with it, even if one was picked before changing mind.
    expect(going(leaving({ products: 1, units: 4 }), { stock: "discard", stockTo: "main", peopleTo: "" }))
      .toEqual({ stock: "discard" });
  });

  it("says how much stock the question is about", () => {
    expect(stockSays({ products: 14, units: 320 })).toBe("14 products (320 units)");
    expect(stockSays({ products: 1, units: 1 })).toBe("1 product (1 unit)");
    expect(stockSays({ products: 2, units: 92.9 })).toBe("2 products (92.9 units)");
  });
});
