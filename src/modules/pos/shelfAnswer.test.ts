import { describe, expect, it } from "vitest";

import { sameQuestion, shelfCouldNotLoad } from "./shelfAnswer";

const everything = { search: "", categoryId: "" };
const brufen = { search: "Brufen", categoryId: "" };

describe("a search that failed is said to have failed — not left under the last list", () => {
  it("with nothing wrong, the shelf draws what it has", () => {
    expect(shelfCouldNotLoad(null, 20, everything, brufen)).toBe(false);
    expect(shelfCouldNotLoad(null, 0, everything, everything)).toBe(false);
  });

  it("a failed search over the PREVIOUS list is a failure — those tiles are not its answer", () => {
    // Twenty items from before the cashier typed anything, and the search for
    // "Brufen" turned away. It used to leave the twenty up, with nothing said.
    expect(shelfCouldNotLoad("Too many requests. Please slow down.", 20, everything, brufen)).toBe(true);
  });

  it("another category that failed does not go on showing the last one's shelf", () => {
    expect(shelfCouldNotLoad("The server did not answer.", 12, { search: "", categoryId: "drinks" }, { search: "", categoryId: "snacks" })).toBe(true);
  });

  it("a failed REFRESH of the same list leaves it up: it is still the answer", () => {
    // The same question asked again in the background. What is on screen is
    // true as of a moment ago, and a counter mid-sale should not lose it.
    expect(shelfCouldNotLoad("The server did not answer.", 20, brufen, brufen)).toBe(false);
  });

  it("an empty shelf that failed says so, as it always did", () => {
    expect(shelfCouldNotLoad("The server did not answer.", 0, everything, everything)).toBe(true);
  });

  it("a space typed after a word is the same question", () => {
    expect(sameQuestion({ search: "Brufen ", categoryId: "" }, brufen)).toBe(true);
    expect(sameQuestion(brufen, { search: "Brufen", categoryId: "pain" })).toBe(false);
  });
});
