import { describe, expect, it } from "vitest";

/**
 * WHAT GOES IN THE BRANCH COLUMN.
 *
 * The hook itself needs a query client to test; the DECISION it makes does not,
 * and the decision is the part that can be quietly wrong. Both answers below
 * are deliberate, and one of them is the sort of thing that reads as a rounding
 * error until it is a record of money pointing at the wrong shop.
 */

import { branchLabel } from "./useBranchColumn";

// The real function, curried for readability. Restating the rule here would
// only ever prove the restatement.
const labelWith = (list: Array<{ id: string; name: string }>) =>
  (id: string | null | undefined) => branchLabel(list, id);

const LIST = [
  { id: "b1", name: "Main" },
  { id: "b2", name: "Saddar" },
];

describe("an unpinned row reads as Main", () => {
  it("because that is what the server does with it", () => {
    // Not "—". A null branch does not mean the expense happened nowhere; it
    // means nobody pinned it, and the server bills it to Main.
    expect(labelWith(LIST)(null)).toBe("Main");
    expect(labelWith(LIST)(undefined)).toBe("Main");
  });
});

describe("a branch that is not in the list reads as nothing", () => {
  it("and deliberately does not fall back to Main", () => {
    // A branch can be closed and removed while its records remain. Printing
    // "Main" against them would name the WRONG shop on a record of money —
    // worse than printing nothing, which is at least visibly unknown.
    expect(labelWith(LIST)("gone")).toBe("—");
  });

  it("including when the list has not arrived yet", () => {
    // Mid-load the list is empty. Answering "Main" for every row would show a
    // whole page of confident wrong answers for a second, which is exactly long
    // enough for somebody to read one.
    expect(labelWith([])("b2")).toBe("—");
    expect(labelWith([])(null)).toBe("Main");
  });
});

describe("a known branch reads as its name", () => {
  it("names it", () => {
    expect(labelWith(LIST)("b2")).toBe("Saddar");
  });
});
