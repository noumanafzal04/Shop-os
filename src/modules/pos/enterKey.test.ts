import { describe, expect, it } from "vitest";
import { enterMeans, looksLikeACode } from "./enterKey";

const shelf = [
  { sku: "QA-CASE", barcode: "8964000100017" },
  { sku: "QA-OIL-5L", barcode: null },
  { sku: null, barcode: null },
];

describe("what Enter means in the till's search box", () => {
  it("is the highlighted tile when nothing is typed — walking the shelf with the arrows", () => {
    expect(enterMeans("", shelf, 1)).toEqual({ do: "tile", index: 1 });
    expect(enterMeans("   ", shelf, 0)).toEqual({ do: "tile", index: 0 });
  });

  it("is nothing on an empty shelf with nothing typed", () => {
    expect(enterMeans("", [], 0)).toEqual({ do: "nothing" });
  });

  it("is a barcode for a long run of digits, whatever is on screen", () => {
    expect(enterMeans("8964000100017", shelf, 2)).toEqual({ do: "scan" });
    expect(enterMeans("12345", [], 0)).toEqual({ do: "scan" });
  });

  it("is THAT item when the term is exactly its code — not whichever is highlighted", () => {
    // The scanner typed the second item's label; the first is highlighted.
    expect(enterMeans("QA-OIL-5L", shelf, 0)).toEqual({ do: "tile", index: 1 });
    expect(enterMeans("qa-oil-5l", shelf, 0)).toEqual({ do: "tile", index: 1 });
  });

  it("is a code to look up when the list has nothing for it — a pack, a size, a unit's own serial", () => {
    expect(enterMeans("5CG1234XYZ", [], 0)).toEqual({ do: "scan" });
    expect(enterMeans("E2E-UNIT-0001", [], 0)).toEqual({ do: "scan" });
    // Even a word: the list said no, so the lookup gets to say so too.
    expect(enterMeans("tea", [], 0)).toEqual({ do: "scan" });
  });

  it("is looked up as a code FIRST when it looks like one, and the highlighted match only if nothing carries it", () => {
    // "a15" typed to find the Galaxy A15: no item has that code, so the tile is what was meant.
    expect(enterMeans("a15", shelf, 2)).toEqual({ do: "code-then-tile", index: 2 });
  });

  it("is the highlighted match for a name", () => {
    expect(enterMeans("oil", shelf, 1)).toEqual({ do: "tile", index: 1 });
    expect(enterMeans("galaxy a15", shelf, 0)).toEqual({ do: "tile", index: 0 });
  });

  it("never points past the end of the list", () => {
    expect(enterMeans("oil", shelf, 99)).toEqual({ do: "tile", index: 2 });
    expect(enterMeans("oil", shelf, -4)).toEqual({ do: "tile", index: 0 });
  });

  it("is not an item's code just because the item has none", () => {
    expect(enterMeans("x9", [{ sku: "", barcode: "  " }, { sku: null }], 0)).toEqual({ do: "code-then-tile", index: 0 });
  });

  it("reads a code with spaces round it as the code", () => {
    expect(enterMeans("  QA-CASE ", shelf, 2)).toEqual({ do: "tile", index: 0 });
    // The label was saved with a space after it: still that item, not the highlighted one.
    expect(enterMeans("QA-OIL-5L", [{ sku: "OTHER" }, { sku: " QA-OIL-5L " }], 0)).toEqual({ do: "tile", index: 1 });
  });
});

describe("a term that looks like a code", () => {
  it("has no spaces and a digit in it", () => {
    expect(looksLikeACode("QA-OIL-5L")).toBe(true);
    expect(looksLikeACode("5CG1234XYZ")).toBe(true);
    expect(looksLikeACode("a15")).toBe(true);
  });

  it("is not a word, and not two words", () => {
    expect(looksLikeACode("tea")).toBe(false);
    expect(looksLikeACode("galaxy a15")).toBe(false);
  });
});
