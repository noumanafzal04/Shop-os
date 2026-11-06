import { describe, expect, it } from "vitest";

import { mayChangeAt, soldAtForNew, soldAtOf, soldAtPayload, soldAtWords, toggleBranch } from "./soldAt";

const MAIN = "b-main";
const TOWN = "b-town";

describe("where an item is sold", () => {
  it("starts the owner at All, and anyone else at their own branch", () => {
    expect(soldAtForNew(true, MAIN)).toEqual({ all: true, ids: [] });
    expect(soldAtForNew(false, TOWN)).toEqual({ all: false, ids: [TOWN] });
    // Nobody pinned (a one-branch shop's staff): the server's All stands.
    expect(soldAtForNew(false, null)).toEqual({ all: true, ids: [] });
  });

  it("reads a product by its places and a category by its ids; absent is everywhere", () => {
    expect(soldAtOf({ all_branches: false, places: [{ id: TOWN, name: "Johar Town" }] })).toEqual({ all: false, ids: [TOWN] });
    expect(soldAtOf({ all_branches: false, branch_ids: [MAIN] })).toEqual({ all: false, ids: [MAIN] });
    expect(soldAtOf({})).toEqual({ all: true, ids: [] });
    expect(soldAtOf(null)).toEqual({ all: true, ids: [] });
  });

  it("sends nothing until the field is touched, so the server's rule decides", () => {
    expect(soldAtPayload(null)).toEqual({});
    expect(soldAtPayload({ all: true, ids: [TOWN] })).toEqual({ all_branches: true });
    expect(soldAtPayload({ all: false, ids: [TOWN] })).toEqual({ all_branches: false, branch_ids: [TOWN] });
  });

  it("lets a branch manager change only what is theirs alone", () => {
    expect(mayChangeAt(false, { all_branches: true }, TOWN)).toBe(false);
    expect(mayChangeAt(false, { all_branches: false, branch_ids: [TOWN, MAIN] }, TOWN)).toBe(false);
    expect(mayChangeAt(false, { all_branches: false, branch_ids: [MAIN] }, TOWN)).toBe(false);
    expect(mayChangeAt(false, { all_branches: false, branch_ids: [TOWN] }, TOWN)).toBe(true);
    expect(mayChangeAt(true, { all_branches: true }, TOWN)).toBe(true);
  });

  it("says All, or the names, and never an empty badge", () => {
    const names = new Map([[MAIN, "Main"], [TOWN, "Johar Town"]]);
    expect(soldAtWords({ all: true, ids: [] }, names)).toBe("All branches");
    expect(soldAtWords({ all: false, ids: [MAIN, TOWN] }, names)).toBe("Main, Johar Town");
    expect(soldAtWords({ all: false, ids: ["gone"] }, names)).toBe("No branch");
  });

  it("keeps the last ticked branch: an item is sold somewhere", () => {
    expect(toggleBranch({ all: false, ids: [TOWN] }, TOWN)).toEqual({ all: false, ids: [TOWN] });
    expect(toggleBranch({ all: false, ids: [TOWN, MAIN] }, TOWN)).toEqual({ all: false, ids: [MAIN] });
    expect(toggleBranch({ all: true, ids: [] }, MAIN)).toEqual({ all: false, ids: [MAIN] });
  });
});
