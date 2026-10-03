/**
 * THE BRAND RAMP, as Tailwind's twelve steps.
 *
 * ── Why the panel holds its own copy ─────────────────────────────────
 *
 * Same reason as `common/brand.ts`: the origin is
 * `core/src/theme/palette.ts`, and `core` is a sibling repo that does not
 * exist on the server this is built on. An import of it compiles here and
 * fails there — which it did, in `tsc -b` on the droplet.
 *
 * `brandRamp.test.ts` compares these values to core's when `../core` is
 * present, and to `index.css` always. So there are two copies and two things
 * holding them together, instead of the three copies and nothing that this
 * replaced — #0755e9 in the stylesheet, #465fff in the tenant theme, and the
 * phones' own primary, all shipping at once.
 *
 * 500 is #1A759F, and it sits there rather than three steps lighter because
 * that is the lightest step of the strip a WHITE BUTTON LABEL can be read on:
 * 5.14:1, against 3.98:1 one step up.
 *
 * 25 and 950 are the two steps a ten-point scale does not have. 25 is a wash
 * a whole page can sit on; 950 is deeper than a phone needed.
 */
export const oceanBrandWeb = {
  25: "#f5f9fc",
  50: "#eaf3f8",
  100: "#cfe6f0",
  200: "#a6d2e3",
  300: "#6bb6cf",
  400: "#168aad",
  500: "#1a759f",
  600: "#1e6091",
  700: "#184e77",
  800: "#143f61",
  900: "#0f2f49",
  950: "#0a2033",
} as const;
