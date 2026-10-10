import { describe, expect, it } from "vitest";

import { savedNotes } from "./savedNotes";

describe("what the server said about an entry it has just saved", () => {
  it("is every warning, in the order they came — not only the first", () => {
    expect(savedNotes({ warnings: ["Over this month's Rent budget by Rs 4,000.", "Paid in cash with no drawer open."] }))
      .toEqual(["Over this month's Rent budget by Rs 4,000.", "Paid in cash with no drawer open."]);
  });

  it("is nothing when the save had nothing to add", () => {
    expect(savedNotes({ warnings: [] })).toEqual([]);
    expect(savedNotes({})).toEqual([]);
    expect(savedNotes(undefined)).toEqual([]);
    expect(savedNotes(null)).toEqual([]);
  });

  it("is not fooled by a meta that is not shaped like one", () => {
    expect(savedNotes({ warnings: "Over budget." })).toEqual([]);
    expect(savedNotes({ warnings: [null, "", "   ", 7, "Over budget."] })).toEqual(["Over budget."]);
  });
});
