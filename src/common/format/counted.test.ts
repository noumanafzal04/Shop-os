import { describe, expect, it } from "vitest";

import { counted, countedList } from "./counted";

describe("a count with its noun", () => {
  it("is singular for exactly one, and plural for everything else", () => {
    expect(counted(1, "item")).toBe("1 item");
    expect(counted(3, "item")).toBe("3 items");
    expect(counted(0, "item")).toBe("0 items");
    expect(counted(2.5, "day")).toBe("2.5 days");
  });

  it("takes a plural that is not the noun with an s", () => {
    expect(counted(2, "box", "boxes")).toBe("2 boxes");
    expect(counted(1, "box", "boxes")).toBe("1 box");
  });

  it("reads a number that arrived as text, and nothing as none", () => {
    expect(counted("1.000", "item")).toBe("1 item");
    expect(counted("12", "member")).toBe("12 members");
    expect(counted(null, "review")).toBe("0 reviews");
    expect(counted(undefined, "product")).toBe("0 products");
  });

  it("never writes the undecided (s)", () => {
    for (const n of [0, 1, 2, 10.5]) expect(counted(n, "item")).not.toContain("(s)");
  });
});

describe("a list's count in its own noun (retail #12)", () => {
  it("says the one when a filter leaves one row", () => {
    expect(countedList(1, "people")).toBe("1 person");
    expect(countedList(1, "sales")).toBe("1 sale");
    expect(countedList(1, "entries")).toBe("1 entry");
    expect(countedList(1, "past orders")).toBe("1 past order");
    expect(countedList(1, "orders being worked")).toBe("1 order being worked");
    expect(countedList(1, "staff")).toBe("1 staff");
    expect(countedList(1, "expenses")).toBe("1 expense");
  });

  it("keeps the plural for every other count", () => {
    expect(countedList(0, "people")).toBe("0 people");
    expect(countedList(1200, "sales")).toBe((1200).toLocaleString() + " sales");
  });
});
