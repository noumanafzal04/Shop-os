import { describe, expect, it } from "vitest";

import { axisNames, sizeCount, sizeHeading, sizeWord } from "./sizeWord";

/**
 * A laptop shop typed "Model" and the till asked "Which size?". The question
 * about one item is asked in that item's own word.
 */
describe("what an item's sizes are called", () => {
  const laptop = { variant_axes: [{ name: "Model", values: ["Core i5 / 8GB / 256GB", "Core i7 / 16GB / 512GB"] }] };
  const shirt = { variant_axes: [{ name: "Size", values: ["S", "M"] }, { name: "Colour", values: ["Red"] }] };

  it("reads the names the shop typed", () => {
    expect(axisNames(laptop)).toEqual(["Model"]);
    expect(axisNames(shirt)).toEqual(["Size", "Colour"]);
  });

  it("asks a laptop for its model, a shirt for its size and colour", () => {
    expect(sizeWord(axisNames(laptop))).toBe("model");
    expect(sizeWord(axisNames(shirt))).toBe("size and colour");
    expect(sizeWord(["Size", "Colour", "Sleeve"])).toBe("size, colour and sleeve");
  });

  it("says size only for an item that never said what varies", () => {
    // An older item, or one that came in from a file, kept no names.
    for (const attrs of [null, undefined, {}, { variant_axes: "Model" }, { variant_axes: [{ values: [] }] }, { variant_axes: [{ name: "  " }] }]) {
      expect(sizeWord(axisNames(attrs as Record<string, unknown> | null | undefined))).toBe("size");
    }
  });

  it("heads the grid with the same names, joined the way the versions are", () => {
    expect(sizeHeading(["Model"])).toBe("Model");
    expect(sizeHeading(["Size", "Colour"])).toBe("Size / Colour");
    expect(sizeHeading([])).toBe("Size");
    expect(sizeHeading([""])).toBe("Size");
  });

  it("counts sizes as sizes and anything else as options", () => {
    expect(sizeCount(["Size"], 12)).toBe("12 sizes");
    expect(sizeCount([], 1)).toBe("1 size");
    expect(sizeCount(["Model"], 2)).toBe("2 options");
    expect(sizeCount(["Storage"], 1)).toBe("1 option");
    expect(sizeCount(["Size", "Colour"], 6)).toBe("6 options");
  });
});
