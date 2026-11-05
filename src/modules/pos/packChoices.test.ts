import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { packChoices } from "./packChoices";

/**
 * #POS4 — a chemist sells a STRIP, and the till's tap rang one tablet; the pack
 * was a "Sale Unit" inside the line's sheet. The row now carries a button per
 * pack, priced as the line will be.
 */
describe("a button per pack under the row", () => {
  const panadol = {
    base: 3,
    unit: "Tablet",
    units: [
      { id: "strip", name: "Strip", factor: "10", price: "30" },
      { id: "box", name: "Box", factor: "100", price: "290" },
    ],
  };

  it("offers the tablet, the strip and the box, each at the price the line will carry", () => {
    expect(packChoices({ ...panadol, left: 200 }).map((c) => [c.unitId, c.label, c.price, c.why])).toEqual([
      [null, "Tablet", 3, null],
      ["strip", "Strip (10)", 30, null],
      ["box", "Box (100)", 290, null],
    ]);
  });

  it("a pack with no price of its own is its pieces at the piece price", () => {
    const [, pack] = packChoices({ base: 2.5, unit: "Tablet", units: [{ id: "s", name: "Strip", factor: 10, price: null }], left: null });
    expect(pack.price).toBe(25);
  });

  it("a pack bigger than what is left is switched off, and says why", () => {
    const choices = packChoices({ ...panadol, left: 60 });
    expect(choices.find((c) => c.unitId === "box")?.why).toBe("Only 60 Tablet left");
    expect(choices.find((c) => c.unitId === "strip")?.why).toBeNull();
  });

  it("an item that keeps no count is never short", () => {
    expect(packChoices({ ...panadol, left: null }).every((c) => c.why === null)).toBe(true);
  });

  it("no packs, no buttons — the row stays as it was", () => {
    expect(packChoices({ base: 120, unit: null, units: [], left: 40 })).toEqual([]);
    expect(packChoices({ base: 120, unit: null, units: undefined, left: 40 })).toEqual([]);
  });

  it("the till's rows draw them and ring the chosen pack through the same fences as a tap", () => {
    const till = readFileSync(resolve(__dirname, "pages/PosPage.tsx"), "utf8");
    expect(till).toContain("packChoices({");
    const ring = till.slice(till.indexOf("const commitPack = "), till.indexOf("const commitPack = ") + 1200);
    expect(ring).toContain("whyNotSellable(p)");
    expect(ring).toMatch(/addLine\(p, null, undefined, undefined, undefined, unitId\)/);
  });
});
