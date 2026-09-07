import { describe, expect, it } from "vitest";
import { BANNER_RATIO, bannerShapeProblem } from "./bannerShape";

/**
 * "BANNER CUTTING ON MOBILE, NOT FULL BANNER SHOWING."
 *
 * Reported against a 1200×480 file — the size this form used to ask for — while
 * the app draws 2:1 and fills the card. Nothing checked the shape, so the crop
 * was only discoverable by publishing and going to look.
 */

describe("artwork that is not 2:1", () => {
  it("names what was sent, what is wanted, and which edges go", () => {
    const message = bannerShapeProblem(1200, 480);

    expect(message).toContain("1200×480");
    expect(message).toContain("2.5:1");
    expect(message).toContain("1200×600");
  });

  it("says LEFT AND RIGHT for a too-wide file", () => {
    /**
     * The mistake worth a test of its own.
     *
     * `cover` scales the image so it covers the card and lets the surplus hang
     * off. A 2.5:1 file in a 2:1 card is relatively wider, so it is matched to
     * the card's HEIGHT and spills sideways.
     *
     * The first version of this warning — and the comment above the form's
     * hint — said "top and bottom". A warning pointing at the wrong axis is
     * worse than none: it sends somebody to move the text they had already put
     * in the right place.
     */
    expect(bannerShapeProblem(1200, 480)).toContain("left and right");
    expect(bannerShapeProblem(1200, 480)).not.toContain("top and bottom");
  });

  it("says TOP AND BOTTOM for a too-tall file", () => {
    // The other half of the rule, and the half nobody reports — a square logo
    // uploaded as a banner loses half of itself.
    expect(bannerShapeProblem(600, 600)).toContain("top and bottom");
    expect(bannerShapeProblem(600, 600)).not.toContain("left and right");
  });

  it("says how much is lost", () => {
    // 480/600 of the width survives a 2.5:1 file, so a fifth goes.
    expect(bannerShapeProblem(1200, 480)).toContain("20%");
    // A square loses half.
    expect(bannerShapeProblem(600, 600)).toContain("50%");
  });
});

describe("artwork that is 2:1", () => {
  it("passes at the size the form asks for", () => {
    // THE DENOMINATOR. A check that refused everything would satisfy every
    // assertion above while making the form ask for a file it rejects.
    expect(bannerShapeProblem(1200, 600)).toBeNull();
  });

  it("passes at other 2:1 sizes, because the rule is a ratio", () => {
    expect(bannerShapeProblem(800, 400)).toBeNull();
    expect(bannerShapeProblem(2400, 1200)).toBeNull();
  });

  it("does not refuse a difference nobody can see", () => {
    // An exact ratio would refuse these. 1200×610 crops by eight pixels off a
    // 1200-pixel width; a rule strict enough to be arithmetically pure is one
    // that sends designers back to a file that was fine.
    expect(bannerShapeProblem(1200, 610)).toBeNull();
    expect(bannerShapeProblem(1200, 590)).toBeNull();
  });

  it("refuses just outside the band", () => {
    // The other edge of the tolerance, so widening it silently is not free.
    // 1200×550 is 2.18:1 — an 8% crop, and visible.
    expect(bannerShapeProblem(1200, 550)).not.toBeNull();
  });
});

describe("dimensions that are not dimensions", () => {
  it("stays silent, because the file type rules own that refusal", () => {
    // A text file renamed to .jpg should be told it is not an image, not
    // lectured about aspect ratios.
    expect(bannerShapeProblem(0, 0)).toBeNull();
    expect(bannerShapeProblem(NaN, NaN)).toBeNull();
    expect(bannerShapeProblem(-1, 100)).toBeNull();
  });
});

describe("the ratio itself", () => {
  it("is the one the phone draws", () => {
    // `PromoCarousel`: cardWidth = screen − 32, cardHeight = cardWidth / 2.
    // If this constant moves, the form starts asking for a size the app does
    // not draw and every banner is cropped again.
    expect(BANNER_RATIO).toBe(2);
  });
});
