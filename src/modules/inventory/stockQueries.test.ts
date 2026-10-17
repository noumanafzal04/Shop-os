import { describe, expect, it } from "vitest";

import type { ProductFilters } from "../catalog/types";
import { stockQueries } from "./stockQueries";

/** The question, without how much of the answer is wanted or which page. */
const question = (f: ProductFilters) => {
  const { per_page: _p, page: _g, search: _s, ...rest } = f;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
};

describe("the stock screen's list and the counts above it", () => {
  // The user, 2026-10-17: "out of stock kafi hain lkn 1 count q show kr
  // raha". The count asked for counted items; the list asked for every item.
  it("ask the same question", () => {
    expect(question(stockQueries.list("all", "", 1))).toEqual(question(stockQueries.all));
    expect(question(stockQueries.list("out", "", 1))).toEqual(question(stockQueries.out));
  });

  it("list only what is counted, and count what is not", () => {
    expect(stockQueries.list("all", "", 1).track_inventory).toBe(true);
    expect(stockQueries.uncounted.track_inventory).toBe(false);
    expect(question(stockQueries.uncounted)).toEqual({ ...question(stockQueries.all), track_inventory: false });
  });

  it("carry the search and the page into the rows only", () => {
    expect(stockQueries.list("all", "rice", 3)).toMatchObject({ search: "rice", page: 3 });
  });
});
