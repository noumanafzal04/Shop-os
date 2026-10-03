import { glyphsFor } from "@cartze/core/ui/FocusedStatusBar";
import { lightColors, darkColors, meadowLightColors, meadowDarkColors } from "@cartze/core/theme/themes";
import { PROJECT_ROOT, codeOnly, fs, path, sourceFiles } from "./support/node";

/**
 * THE CLOCK HAS TO BE READABLE, ON EVERY SCREEN AND IN BOTH THEMES.
 *
 * Five screens each stated the polarity by hand and three were wrong on at
 * least one theme. The shop page was the one anybody could see: it asked for
 * `"dark-content"` unconditionally, so on a near-black page the clock, the
 * battery and the signal bars vanished.
 *
 * The others are the same defect pointing the other way. The market and
 * account screens draw white glyphs on `primary`, which is #1a759f in light
 * (fine, 5.1:1) and #4bb3d4 in dark — a bright cyan that white cannot be read
 * on at all.
 *
 * The fix is that the polarity is DERIVED from the ground, so these cases
 * check the derivation and then check that no screen has gone back to
 * stating it.
 */

const contrast = (a: string, b: string) => {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      })
      .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("the polarity follows the ground", () => {
  it("puts light glyphs on a dark ground and dark glyphs on a light one", () => {
    expect(glyphsFor("#000000")).toBe("light-content");
    expect(glyphsFor("#ffffff")).toBe("dark-content");
  });

  it("answers correctly for every ground a screen actually passes", () => {
    /**
     * The real pairs, not invented ones. Each entry is a ground some screen
     * hands this component, and the assertion is that whichever glyph colour
     * comes back is the one that can be READ on it — measured, so the rule
     * cannot be satisfied by agreeing with itself.
     */
    const grounds = [
      ["home header", meadowLightColors.gradient[0]],
      ["home header dark", meadowDarkColors.gradient[0]],
      ["page light", meadowLightColors.bg],
      ["page dark", meadowDarkColors.bg],
      ["brand light", meadowLightColors.primary],
      // The one that was broken: a bright cyan carrying white glyphs.
      ["brand dark", meadowDarkColors.primary],
      ["rider page light", lightColors.bg],
      ["rider page dark", darkColors.bg],
      ["rider brand dark", darkColors.primary],
    ] as const;

    for (const [name, ground] of grounds) {
      const glyphs = glyphsFor(ground);
      const ink = glyphs === "light-content" ? "#ffffff" : "#000000";
      expect({ [name]: contrast(ink, ground) >= 4.5 }).toEqual({ [name]: true });
    }
  });

  it("refuses to guess when it cannot read the ground", () => {
    // `default` hands the choice back to the OS. Picking one would be the
    // original bug, arrived at by a different route.
    expect(glyphsFor(undefined)).toBe("default");
    expect(glyphsFor("rgba(255,255,255,0.18)")).toBe("default");
    expect(glyphsFor("transparent")).toBe("default");
  });

  it("understands the short form as well as the long", () => {
    expect(glyphsFor("#fff")).toBe(glyphsFor("#ffffff"));
    expect(glyphsFor("#000")).toBe(glyphsFor("#000000"));
  });
});

describe("no screen states the polarity by hand", () => {
  it("passes a ground and lets the rule decide", () => {
    /**
     * The override still exists, for a ground this component cannot be told
     * about — an image behind the bar. Nothing needs it today, so the rule
     * here is "none", and a screen that genuinely does will have to come and
     * say why in this file rather than copying a literal from a neighbour.
     */
    const offenders: string[] = [];

    for (const file of sourceFiles(path.join(PROJECT_ROOT, "src"))) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));
      if (!src.includes("<FocusedStatusBar")) continue;

      for (const line of src.split("\n")) {
        if (/<FocusedStatusBar[^>]*\bstyle=/.test(line)) {
          offenders.push(`${path.relative(PROJECT_ROOT, file)}: ${line.trim()}`);
        }
      }
    }

    expect(offenders.join("\n")).toBe("");
  });
});
