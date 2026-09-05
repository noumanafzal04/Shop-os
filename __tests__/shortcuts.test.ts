import { SHORTCUTS } from "../src/modules/marketplace/tradeIcon";
import { activeFilterCount } from "../src/modules/marketplace/components/FilterSheet";

/**
 * A shortcut has to narrow something, and no two may narrow the same thing.
 *
 * All four of these once navigated to the shop list passing only a TITLE, so
 * "Offers", "Pick-up", "New shops" and "Top rated" produced the identical
 * unfiltered list of every shop with a different heading over it. Nothing
 * failed; the screen looked finished; the claim was the heading.
 *
 * Typing `filters` as required stops the field being MISSING. It does not stop
 * it being `{}`, or being a copy of its neighbour's — which is the same bug
 * with a value in it. That is what this asks.
 */

describe("home shortcuts", () => {
  // A count of findings is not evidence without a count of attempts.
  it("has shortcuts to check", () => {
    expect(SHORTCUTS.length).toBeGreaterThanOrEqual(4);
  });

  it.each(SHORTCUTS.map((s) => [s.label, s] as const))("%s narrows something", (_label, s) => {
    // Sort alone does not count: a list is always sorted somehow, so a
    // shortcut whose only effect is an ORDER shows the same rows as the
    // unfiltered aisle — which is exactly what these used to do.
    const narrows = activeFilterCount(s.filters) > 0 || s.filters.sort === "newest";
    expect(narrows).toBe(true);
  });

  it("gives no two shortcuts the same result", () => {
    const seen = SHORTCUTS.map((s) => JSON.stringify(s.filters));
    expect(new Set(seen).size).toBe(SHORTCUTS.length);
  });

  it("only asks the server for sorts it accepts", () => {
    // The endpoint validates `in:name,price_asc,price_desc,newest,discount,rating`
    // and answers 422 for anything else — a shortcut with a typo would be a
    // dead button that looks like a network error.
    const ALLOWED = ["name", "price_asc", "price_desc", "newest", "discount", "rating"];
    for (const s of SHORTCUTS) {
      if (s.filters.sort) expect(ALLOWED).toContain(s.filters.sort);
    }
  });
});
