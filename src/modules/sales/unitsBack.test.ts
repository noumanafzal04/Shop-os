import { describe, expect, it } from "vitest";
import { numbersToSend, saidWhich, unitsOut, whichUnits } from "./unitsBack";

describe("the numbered units of a line still out with the customer", () => {
  const serials = [
    { id: "1", sale_item_id: "line-a", serial: "A1" },
    { id: "2", sale_item_id: "line-a", serial: "A2", returned_at: "2026-10-07T10:00:00Z" },
    { id: "3", sale_item_id: "line-b", serial: "B1" },
    { id: "4", sale_item_id: "line-a", serial: "A3", returned_at: null },
  ];

  it("are that line's, and not the ones already back", () => {
    expect(unitsOut(serials, "line-a").map((u) => u.serial)).toEqual(["A1", "A3"]);
  });

  it("are none on a sale that carries no numbers", () => {
    expect(unitsOut(undefined, "line-a")).toEqual([]);
  });
});

describe("what a return has to say about which units", () => {
  it("is nothing for a line with no numbers out", () => {
    expect(whichUnits(0, 5, 2).mode).toBe("none");
  });

  it("is nothing when nothing is coming back", () => {
    expect(whichUnits(2, 2, 0).mode).toBe("none");
  });

  it("is nothing to choose when the only phone on the bill comes back", () => {
    expect(whichUnits(1, 1, 1).mode).toBe("all");
  });

  it("is nothing to choose when both of two come back", () => {
    expect(whichUnits(2, 2, 2).mode).toBe("all");
  });

  it("is WHICH, when one of two comes back", () => {
    expect(whichUnits(2, 2, 1)).toEqual({ mode: "pick", atLeast: 1, atMost: 1 });
  });

  it("is which two, when two of three come back", () => {
    expect(whichUnits(3, 3, 2)).toEqual({ mode: "pick", atLeast: 2, atMost: 2 });
  });

  it("may be none of them, when a unit that never had a number is what came back", () => {
    // Two left on the line: one by number, one without. One comes back.
    expect(whichUnits(1, 2, 1)).toEqual({ mode: "pick", atLeast: 0, atMost: 1 });
  });

  it("is at least one, when more come back than left without a number", () => {
    // Three left: two by number, one without. Two come back.
    expect(whichUnits(2, 3, 2)).toEqual({ mode: "pick", atLeast: 1, atMost: 2 });
  });

  it("reads a quantity the server sent as a decimal", () => {
    expect(whichUnits(2, 2.0, 1.0).mode).toBe("pick");
  });
});

describe("has the cashier said enough", () => {
  it("yes, where there was nothing to say", () => {
    expect(saidWhich(whichUnits(0, 3, 1), 0)).toBe(true);
    expect(saidWhich(whichUnits(2, 2, 2), 0)).toBe(true);
  });

  it("no, until the unit is ticked", () => {
    const which = whichUnits(2, 2, 1);
    expect(saidWhich(which, 0)).toBe(false);
    expect(saidWhich(which, 1)).toBe(true);
  });

  it("no, with more ticked than are coming back", () => {
    expect(saidWhich(whichUnits(3, 3, 1), 2)).toBe(false);
  });
});

describe("what is sent for a returned line", () => {
  it("is the numbers ticked, when there was a choice", () => {
    expect(numbersToSend(whichUnits(2, 2, 1), ["A1"])).toEqual(["A1"]);
  });

  it("is an EMPTY list — said, not omitted — when the unit that came back had no number", () => {
    expect(numbersToSend(whichUnits(1, 2, 1), [])).toEqual([]);
  });

  it("is nothing where the server needs nothing said", () => {
    expect(numbersToSend(whichUnits(1, 1, 1), ["A1"])).toBeUndefined();
    expect(numbersToSend(whichUnits(0, 4, 2), [])).toBeUndefined();
  });
});
