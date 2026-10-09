import { describe, expect, it } from "vitest";

import { suggestPassword } from "./suggestPassword";

/**
 * A password that is going to be SAID — to a shopkeeper, across a counter —
 * and typed into a phone.
 */
describe("suggestPassword", () => {
  it("is three short things to say", () => {
    for (let i = 0; i < 50; i++) {
      expect(suggestPassword()).toMatch(/^[a-z]{4}-[2-9]{4}-[a-z]{4}$/);
    }
  });

  it("has nothing in it that sounds like something else", () => {
    // Every letter and digit it can produce, by rolling every value.
    const everything = Array.from({ length: 30 }, (_, n) => suggestPassword((count) => Array.from({ length: count }, () => n))).join("");

    expect(everything).not.toMatch(/[ilo01]/);
    // …and it does use the whole of both alphabets, not the first few of each.
    expect(new Set(everything.replace(/[^a-z]/g, "")).size).toBe(23);
    expect(new Set(everything.replace(/[^0-9]/g, "")).size).toBe(8);
  });

  it("is long enough for the server, which wants eight", () => {
    expect(suggestPassword().length).toBeGreaterThanOrEqual(8);
  });

  it("is a different one each time", () => {
    const made = new Set(Array.from({ length: 40 }, () => suggestPassword()));

    expect(made.size).toBe(40);
  });

  it("uses every roll it asks for — no character is decided by its neighbour's", () => {
    const rolls = [0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7];

    expect(suggestPassword(() => rolls)).toBe("abcd-2345-efgh");
  });
});
