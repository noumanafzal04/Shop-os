import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { oceanBrandWeb } from "./oceanRamp";
import { DEFAULT_PRIMARY } from "./tenantTheme";

/**
 * THE BRAND RAMP IS WRITTEN ONCE, AND THE STYLESHEET CANNOT IMPORT IT.
 *
 * ── What this is the fix for ─────────────────────────────────────────
 *
 * Three different "primary" colours were shipping at the same time:
 *
 *   #0755e9   `--color-brand-500` in index.css — every button and link
 *   #465fff   `DEFAULT_PRIMARY` in tenantTheme.ts — what a shop resets to
 *   #1a759f   `meadowThemes.light.primary` — what the two phone apps draw
 *
 * Nothing was wrong with any of them in isolation, which is exactly the
 * problem: each was correct when it was written and none knew about the
 * others. The logo made it visible — the mark was cut in the stylesheet's
 * blue while the phones had moved to the ocean.
 *
 * The hexes now live in `@cartze/core/theme/palette`, which has no
 * `react-native` import precisely so a browser bundle can read it.
 * `tenantTheme.ts` imports it. CSS cannot, so this stands in for the import.
 *
 * ── Why the failure message names the step ───────────────────────────
 *
 * The cost of this bug class is the hunt, not the edit. "Expected '#0755e9'
 * to be '#1a759f'" in a 700-line stylesheet is a ten-minute search; naming
 * the custom property makes it a ten-second one.
 */

const ROOT = path.resolve(__dirname, "../../..");
const css = fs.readFileSync(path.resolve(ROOT, "src/index.css"), "utf8");

describe("the panel's brand ramp matches the shared palette", () => {
  it.each(Object.entries(oceanBrandWeb))("--color-brand-%s", (step, hex) => {
    const found = new RegExp(`--color-brand-${step}:\\s*(#[0-9a-fA-F]{3,8});`).exec(css)?.[1];

    expect({ step: `--color-brand-${step}`, hex: found?.toLowerCase() }).toEqual({
      step: `--color-brand-${step}`,
      hex: String(hex).toLowerCase(),
    });
  });

  it("reads the stylesheet it claims to read", () => {
    // Without this, a path that stopped resolving would make every case above
    // compare `undefined` to a hex and fail loudly — but a REGEX that stopped
    // matching would be silent if the assertions were written the other way
    // round. Cheap, and it pins the assumption.
    expect(css).toContain("--color-brand-500");
    expect(css.length).toBeGreaterThan(5000);
  });

  it("resets a shop to the same primary the ramp is built on", () => {
    // `applyTenantTheme` derives a whole 25→950 scale from whatever colour a
    // shop picks. `DEFAULT_PRIMARY` is what "no choice" means, so it has to
    // be the ramp's own 500 or the default theme is a fourth blue.
    expect(DEFAULT_PRIMARY.toLowerCase()).toBe(oceanBrandWeb[500].toLowerCase());
  });

  /**
   * THE OTHER COPY — `core/src/theme/palette.ts`, which the two phone apps
   * read, and which this app cannot import.
   *
   * It cannot import it because `core` is a SIBLING REPOSITORY. It sits
   * beside this folder on a developer's machine and does not exist on the
   * server, where only this repo is checked out — so an import of it builds
   * here and fails there, which is exactly what happened.
   *
   * The file is therefore read as TEXT, and only when it is present. On a
   * machine with the full checkout — every machine a change to the palette
   * is actually written on — this is what stops the phones and the panel
   * drifting apart again. On a panel-only checkout there is nothing to
   * compare and the case says so rather than inventing a pass.
   */
  it("agrees with the palette the phone apps read", () => {
    const shared = path.resolve(ROOT, "../core/src/theme/palette.ts");

    if (!fs.existsSync(shared)) {
      // Stated, not silently skipped. A guard that can quietly do nothing is
      // a guard nobody notices has stopped guarding.
      expect({ "core checkout present": false, compared: "nothing" }).toEqual({
        "core checkout present": false,
        compared: "nothing",
      });
      return;
    }

    const src = fs.readFileSync(shared, "utf8");
    const block = src.slice(src.indexOf("export const oceanBrand: ColorScale"));

    for (const [step, hex] of Object.entries(oceanBrandWeb)) {
      // 25 and 950 are the panel's own two extra steps — `core` holds a
      // ten-point scale, and asking it for twelve would fail for the wrong
      // reason.
      if (step === "25" || step === "950") continue;

      const found = new RegExp(`\\b${step}:\\s*"(#[0-9a-fA-F]{6})"`).exec(block)?.[1];
      expect({ step, hex: found?.toLowerCase() }).toEqual({ step, hex: String(hex).toLowerCase() });
    }
  });

  it("keeps a white button label readable on the primary", () => {
    /**
     * The reason the primary sits at this step of the strip rather than three
     * steps up — #168aad is 3.98:1 and would have forced dark button labels
     * across the whole panel. Measured here as well as in the phones' suite,
     * because this is the file a repalette actually gets edited in.
     */
    const lum = (hex: string) => {
      const n = parseInt(hex.replace("#", ""), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        })
        .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
    };
    const onWhite = (1.05) / (lum(oceanBrandWeb[500]) + 0.05);

    expect(onWhite).toBeGreaterThanOrEqual(4.5);
  });
});
