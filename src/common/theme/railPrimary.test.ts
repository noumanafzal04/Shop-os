import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PRIMARY, THEME_PRESETS, buildRamp, railPrimaryFor, whiteOn } from "./tenantTheme";

/**
 * THE PRIMARY SIDEBAR CAN ALWAYS BE READ.
 *
 * Appearance → Sidebar → Primary paints the rail in the shop's own colour
 * with white writing on it. A shop picks that colour freely, and white on
 * yellow is a menu nobody can read — so the rail takes the first shade of the
 * same ramp that carries white at 4.5:1.
 */

// Read from disk, like brandRamp.test: vitest hands a CSS import back empty.
const SOURCE = fs.readFileSync(path.resolve(__dirname, "../../index.css"), "utf8");

describe("which shade of the brand the rail wears", () => {
  it("a colour that can carry white as it is, is simply its 600", () => {
    expect(railPrimaryFor(DEFAULT_PRIMARY)).toBe(buildRamp(DEFAULT_PRIMARY)[600]);
  });

  it.each([
    ["ocean", DEFAULT_PRIMARY],
    ["a red a shop might pick", "#e11d48"],
    ["a green", "#16a34a"],
    ["orange", "#f97316"],
    ["yellow — the one that cannot carry white as it is", "#facc15"],
    ["a very pale blue", "#bfdbfe"],
    ["near black", "#111827"],
  ])("%s carries white writing", (_name, colour) => {
    expect(whiteOn(railPrimaryFor(colour))).toBeGreaterThanOrEqual(4.5);
  });

  it("goes darker only as far as it must — yellow is still a yellow", () => {
    const ramp = buildRamp("#facc15");
    const rail = railPrimaryFor("#facc15");

    // Its 600 fails, so the rail is NOT the 600…
    expect(whiteOn(ramp[600])).toBeLessThan(4.5);
    expect(rail).not.toBe(ramp[600]);
    // …but it is one of that colour's own shades, not a grey.
    expect(Object.values(ramp)).toContain(rail);
  });

  it("measures contrast the way WCAG does", () => {
    expect(whiteOn("#000000")).toBeCloseTo(21, 1);
    expect(whiteOn("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("the stylesheet has a rail to fall back on", () => {
  it("uses the computed shade, and the default ocean when there is none", () => {
    // A shop on the default colour has no --rail-primary set at all.
    expect(SOURCE).toMatch(/\.rail-primary \{\s*background-color: var\(--rail-primary, var\(--color-brand-600\)\);/);
  });

  it("where you are is a white plate in the rail's own colour", () => {
    expect(SOURCE).toMatch(/\.rail-primary \.menu-item-active \{\s*background-color: #fff;\s*color: var\(--rail-primary, var\(--color-brand-600\)\);/);
  });
});

describe("a ramp runs from light to dark, whatever colour it is built on", () => {
  /**
   * Found while writing the rail: `buildRamp` gave every step an ABSOLUTE
   * lightness tuned to the old indigo (0.64). The ocean is 0.36, so its "600"
   * came out at 0.58 — paler than the colour itself. Six of the seven presets
   * a shop can pick had a ramp that got lighter where it should get darker:
   * buttons that paled on hover, and `text-brand-600` in a tint white could
   * not carry. The default hid it by never building a ramp at all.
   */
  const STEPS = [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

  it.each([...THEME_PRESETS.map((p) => [p.name, p.primary] as const), ["a very pale blue", "#bfdbfe"] as const])(
    "%s",
    (_name, colour) => {
      const ramp = buildRamp(colour);
      // More contrast against white = darker. Each step is no lighter than the last.
      const darkness = STEPS.map((step) => whiteOn(ramp[step]));

      for (let i = 1; i < darkness.length; i++) {
        expect(darkness[i], `${STEPS[i]} is lighter than ${STEPS[i - 1]}`).toBeGreaterThanOrEqual(darkness[i - 1] - 0.02);
      }
      // …and the chosen colour is the 500, verbatim.
      expect(ramp[500]).toBe(colour.toLowerCase());
    },
  );

  it("a darker step is darker than the colour it was built from", () => {
    // The sentence the old table broke, stated for the colour it broke on.
    const ocean = buildRamp(DEFAULT_PRIMARY);
    expect(whiteOn(ocean[600])).toBeGreaterThan(whiteOn(ocean[500]));
    expect(whiteOn(ocean[700])).toBeGreaterThan(whiteOn(ocean[600]));
  });
});
