import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";
import { carmineThemes, emeraldThemes } from "@cartze/core/theme/themes";

/**
 * THE FIRST TWO SCREENS ANYBODY SEES.
 *
 * ── The splash showed two colours ────────────────────────────────────
 *
 * "Splash py 2 colors arhy." The window Android paints before JavaScript
 * exists is `@color/brand` in `styles.xml`; the splash painted `brand[500]`
 * from the tokens; and the app the shopper then arrived in is painted by
 * `ThemeProvider`, which gives the SHOPPING side leaf green and the working
 * side ember orange.
 *
 * All three were supposed to be one colour and two of them were the wrong
 * one: the raw `brand` scale is ember, so the icon, the window and the splash
 * were all the rider's orange in front of a green app.
 *
 * The fix is that the splash asks the theme (the store answers `customer`
 * from its first frame) and the two native files hold the SHOPPING side's
 * primary, because Android paints its frame before a mode can exist.
 */

const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

const splash = read("src/common/ui/Splash.tsx");
const intro = read("src/modules/onboarding/OnboardingScreen.tsx");
const styles = fs.readFileSync(
  path.join(PROJECT_ROOT, "android/app/src/main/res/values/styles.xml"),
  "utf8",
);
const colors = fs.readFileSync(
  path.join(PROJECT_ROOT, "android/app/src/main/res/values/colors.xml"),
  "utf8",
);

describe("the splash wears the mode's colour", () => {
  /**
   * THE RULE, and it is the opposite of the one that used to be here.
   *
   * This file previously asserted that the splash must NOT read the themed
   * primary — that it should reach past the theme to `brand[500]`. That was
   * written to fix "splash py 2 colors arhy" and it fixed nothing, because
   * `brand[500]` IS the ember scale: the colour the WORKING side wears.
   * `ThemeProvider` hands the shopping side `emeraldThemes`. So the token was
   * never the customer's colour, and the guard held the bug in place.
   *
   * The store answers `customer` from its first frame — that is its initial
   * value, not something it waits for — so `c.primary` is green for a shopper
   * before anything has resolved, and orange for a rider the moment
   * `hydrateMode` lands.
   */
  it("takes its ground from the theme, not from a raw token", () => {
    expect(splash).toMatch(/GROUND = c\.primary/);
    expect(splash).not.toMatch(/BRAND_SCALE/);
  });

  /**
   * …and for the default answer — customer — that colour is the same one the
   * native window uses. Two places hold it and they cannot read each other (a
   * native resource cannot see a TypeScript file), so the only thing keeping
   * them equal is a check that they are.
   */
  it("is the same colour Android paints before JavaScript exists", () => {
    const native = colors.match(/<color name="brand">(#[0-9a-fA-F]{6})<\/color>/)?.[1];
    expect(native).toBeDefined();

    // The VALUE, not a regex over the file: the shopping side's primary is
    // decided by one line in `ThemeProvider`, and reading the palette itself
    // is the only way this survives that line being turned over again.
    expect(native!.toLowerCase()).toBe(emeraldThemes.light.primary.toLowerCase());
    // And the window actually uses it, rather than defaulting to white.
    expect(styles).toMatch(/windowBackground">@color\/brand/);
  });

  it("puts the same colour under the launcher icon", () => {
    // A green icon opening an orange app was the whole complaint. The icon's
    // ground, the window and the splash are one fact in three files.
    const ground = colors.match(/<color name="ic_launcher_background">(#[0-9a-fA-F]{6})<\/color>/)?.[1];
    expect(ground?.toLowerCase()).toBe(emeraldThemes.light.primary.toLowerCase());
  });

  it("does not paint the working side's colour on the shopping side", () => {
    // Stated as its own case because this is the regression, by hex.
    const native = colors.match(/<color name="brand">(#[0-9a-fA-F]{6})<\/color>/)?.[1];
    expect(native!.toLowerCase()).not.toBe(carmineThemes.light.primary.toLowerCase());
  });

  /** The mark the launcher carries, so tapping the icon leads somewhere that
   *  looks related. */
  it("carries the same mark as the launcher icon", () => {
    expect(splash).toMatch(/<CartIcon/);
  });
});

describe("the introduction", () => {
  /**
   * Asked for photographs; there are none to use. A stock photo of somebody
   * else's shop would be the one place in the app showing a business that
   * does not exist, on the screen that introduces it — so the slides get a
   * coloured panel instead, and this holds that decision still rather than
   * letting a remote URL creep in later.
   */
  it("ships no downloaded imagery", () => {
    expect(intro).not.toMatch(/https?:\/\//);
    expect(intro).not.toMatch(/require\(".*\.(png|jpg|jpeg|webp)"\)/);
  });

  it("gives each slide its own ground, so three read as a set", () => {
    const hues = [...intro.matchAll(/hue:\s*PANEL\.(\w+)/g)].map((m) => m[1]);

    expect(hues).toHaveLength(3);
    expect(new Set(hues).size).toBe(3);
  });

  /**
   * The panel is a fixed height and the copy is not, so the pair is TOP
   * aligned. Centred, the artwork sits at a different height on every slide
   * and paging slides it up and down — which reads as the layout settling
   * rather than as a change of subject.
   */
  it("does not centre a fixed panel over variable copy", () => {
    const slide = intro.match(/slide: \{[^}]*\}/)?.[0] ?? "";

    expect(slide).toContain("paddingTop");
    expect(slide).not.toContain("justifyContent");
  });
});
