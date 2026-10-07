import { describe, expect, it } from "vitest";
import { firstOwing, numbersOn, owed, strangers, unitsOn, withNumber, writtenTwice, type NumberedLine } from "./unitNumbers";

const phone = (over: Partial<NumberedLine> = {}): NumberedLine => ({ key: "a", name: "Galaxy A15", quantity: 1, tracks_serial: true, ...over });
const cover = (over: Partial<NumberedLine> = {}): NumberedLine => ({ key: "c", name: "Phone case", quantity: 3, ...over });

describe("the numbers on a line", () => {
  it("are for whole units, and never fewer than one", () => {
    expect(unitsOn({ quantity: 2 })).toBe(2);
    expect(unitsOn({ quantity: 2.7 })).toBe(2);
    expect(unitsOn({ quantity: 0.4 })).toBe(1);
  });

  it("are the ones written, trimmed, without the gaps", () => {
    expect(numbersOn({ quantity: 3, serials: [" A1 ", "", "C3"] })).toEqual(["A1", "C3"]);
  });

  it("do not include a number in a slot the line no longer has", () => {
    // Two were written, then the quantity went back to one.
    expect(numbersOn({ quantity: 1, serials: ["A1", "B2"] })).toEqual(["A1"]);
  });

  it("are none when nothing was written", () => {
    expect(numbersOn({ quantity: 2 })).toEqual([]);
  });
});

describe("what a line still owes", () => {
  it("is every unit, before anything is written", () => {
    expect(owed(phone({ quantity: 2 }))).toBe(2);
  });

  it("is nothing once each unit has its number", () => {
    expect(owed(phone({ quantity: 2, serials: ["A1", "B2"] }))).toBe(0);
  });

  it("is nothing for an item that is not sold by number", () => {
    expect(owed(cover())).toBe(0);
  });

  it("counts a unit added after the numbers were written", () => {
    expect(owed(phone({ quantity: 3, serials: ["A1", "B2"] }))).toBe(1);
  });
});

describe("the line the till asks about before it takes money", () => {
  it("is the first one owing a number", () => {
    const cart = [cover(), phone({ key: "p1", serials: ["A1"] }), phone({ key: "p2" }), phone({ key: "p3" })];
    expect(firstOwing(cart)?.key).toBe("p2");
  });

  it("is none when every numbered unit has its number", () => {
    expect(firstOwing([cover(), phone({ serials: ["A1"] })])).toBeNull();
  });

  it("is not a line the cashier said goes out without one", () => {
    const cart = [phone({ key: "p1", unnumbered_ok: true }), phone({ key: "p2" })];
    expect(firstOwing(cart)?.key).toBe("p2");
    expect(firstOwing([phone({ unnumbered_ok: true })])).toBeNull();
  });
});

describe("a number written twice", () => {
  it("is found across two lines, and the second line is named", () => {
    const twice = writtenTwice([phone({ key: "p1", serials: ["A1"] }), phone({ key: "p2", serials: ["A1"] })]);
    expect(twice?.serial).toBe("A1");
    expect(twice?.line.key).toBe("p2");
  });

  it("is found on one line", () => {
    expect(writtenTwice([phone({ quantity: 2, serials: ["A1", "A1"] })])?.serial).toBe("A1");
  });

  it("is not a number sitting in a slot the line no longer has", () => {
    expect(writtenTwice([phone({ quantity: 1, serials: ["A1", "A1"] })])).toBeNull();
  });

  it("is nothing on a bill where every number is its own", () => {
    expect(writtenTwice([phone({ key: "p1", serials: ["A1"] }), phone({ key: "p2", serials: ["B2"] }), cover()])).toBeNull();
  });
});

describe("a number scanned onto a line", () => {
  it("goes on the first unit that has none", () => {
    const l = withNumber(phone({ quantity: 2, serials: ["", "B2"] }), "A1");
    expect(l.serials).toEqual(["A1", "B2"]);
    expect(l.quantity).toBe(2);
  });

  it("goes on a line that had nothing written", () => {
    expect(withNumber(phone(), " A1 ")).toMatchObject({ quantity: 1, serials: ["A1"] });
  });

  it("grows the line when every unit already has one", () => {
    const l = withNumber(phone({ quantity: 1, serials: ["A1"] }), "B2");
    expect(l.quantity).toBe(2);
    expect(l.serials).toEqual(["A1", "B2"]);
  });

  it("changes nothing when the same box is scanned twice", () => {
    const before = phone({ quantity: 1, serials: ["A1"] });
    expect(withNumber(before, "A1")).toBe(before);
  });

  it("drops a number left in a slot the line no longer had", () => {
    // Quantity went 2 → 1 with two written; a third is scanned.
    const l = withNumber(phone({ quantity: 1, serials: ["A1", "OLD"] }), "C3");
    expect(l.quantity).toBe(2);
    expect(l.serials).toEqual(["A1", "C3"]);
  });

  it("ignores an empty scan", () => {
    const before = phone();
    expect(withNumber(before, "   ")).toBe(before);
  });
});

describe("a number that is not one of the units on the shelf", () => {
  it("is named when the shop has units on the shelf by number", () => {
    expect(strangers(["A1", "ZZ9", ""], ["A1", "B2"])).toEqual(["ZZ9"]);
  });

  it("is nobody when the shop never wrote numbers down at goods-in", () => {
    expect(strangers(["ZZ9"], [])).toEqual([]);
  });

  it("is nobody when every number written is on the shelf", () => {
    expect(strangers([" A1 "], ["A1", "B2"])).toEqual([]);
  });
});
