import { describe, expect, it } from "vitest";
import { contrastWithWhite, HERO_SWATCHES, isHex, readsUnderWhite } from "./heroColor";

describe("a top banner's colour", () => {
  it("refuses a colour white type cannot be read on", () => {
    expect(readsUnderWhite("#ffd54f")).toBe(false);
    expect(readsUnderWhite("#ffffff")).toBe(false);
  });

  it("accepts the dark ones, and every swatch it offers", () => {
    expect(readsUnderWhite("#03444a")).toBe(true);
    for (const s of HERO_SWATCHES) expect(readsUnderWhite(s)).toBe(true);
  });

  it("agrees with the server's number (HeroColor::contrastWithWhite)", () => {
    // #c62828 is 5.62:1 by WCAG; black against white is 21:1.
    expect(contrastWithWhite("#c62828")).toBeCloseTo(5.62, 1);
    expect(contrastWithWhite("#000000")).toBe(21);
  });

  it("is not fooled by a half-typed hex", () => {
    expect(isHex("#03444")).toBe(false);
    expect(readsUnderWhite("#03444")).toBe(false);
  });
});
