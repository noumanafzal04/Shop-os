import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * "CONSISTENCY NI HAI APP SCREENS MAIN" — measured, then held.
 *
 * ── What the sweep actually found ───────────────────────────────────────
 *
 * Twenty-nine screens, read one axis at a time. `SafeScreen` was on all
 * twenty-nine, which is why nobody had looked further. The headers were not:
 *
 *   THREE back buttons
 *     38×38 · surfaceAlt · no border · icon 19   ← `ScreenHeader`
 *     40×40 · surface    · 1px border · icon 20  ← Addresses, Notifications,
 *                                                  Location, Order, Search
 *     36×36 · no ground  · icon 20               ← the shop page's pinned bar
 *
 *   TWO title sizes on pushed screens
 *     typography.title (22pt)  ← Checkout, Settings, Help, Profile
 *     typography.h3    (17pt)  ← Addresses, Notifications, Location, Order
 *
 * So Profile and My addresses — two rows of the same menu — wore different
 * headers, and neither was wrong on its own. That is what the complaint was.
 *
 * Nine screens were moved onto the shared header; the two that legitimately
 * differ are named below with the reason.
 *
 * ── Why a guard and not just a fix ──────────────────────────────────────
 *
 * Because it grew this way once. `ScreenHeader`'s own docblock says it was
 * written after two screens had no back button at all — and nine more went on
 * to build their own afterwards. A fix without a guard is the same file in
 * three months.
 */
const read = (rel: string) => fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8");

const screens = (function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(PROJECT_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (path.basename(entry.name).endsWith("Screen.tsx")) out.push(rel);
  }

  return out;
})("src/modules").sort();

const name = (rel: string) => rel.split("/").pop()!.replace("Screen.tsx", "");

/**
 * THE TWO THAT MAY DIFFER, and why — not "these fail, skip them".
 *
 * Both draw their back arrow on a PHOTOGRAPH rather than on a surface: the
 * market's dark hero and the shop page's cover band. A grey disc on a
 * photograph is a smudge, so these are borderless and white. Neither is a
 * header; both are overlays on artwork.
 *
 * The shop page's PINNED bar is not in here. That one IS a header — it appears
 * when the cover has scrolled away and the bar sits on a plain surface — and
 * it now wears the same 38pt control as everything else.
 */
const HERO_OVERLAYS = ["src/modules/marketplace/screens/MarketScreen.tsx", "src/modules/marketplace/screens/MarketShopScreen.tsx"];

describe("every screen is built out of the same parts", () => {
  it("found the screens at all", () => {
    // The denominator. A walk that silently matched nothing would make every
    // assertion below vacuous — which is the failure mode of a sweep.
    expect(screens.length).toBeGreaterThanOrEqual(25);
  });

  it("puts every one of them inside SafeScreen", () => {
    const bare = screens.filter((rel) => !codeOnly(read(rel)).includes("SafeScreen"));
    expect(bare.map(name)).toEqual([]);
  });

  it("gives every back arrow the same shape", () => {
    /**
     * The test is not "is there a back button" — it is "where did its shape
     * come from". A screen that draws `ArrowLeftIcon` must take the control
     * from `ScreenHeader` or `HeaderButton`; building one at the call site is
     * how three shapes appeared.
     */
    const rolled = screens.filter((rel) => {
      const code = codeOnly(read(rel));
      if (!code.includes("<ArrowLeftIcon")) return false;
      if (HERO_OVERLAYS.includes(rel)) return false;

      // The arrow must be INSIDE `HeaderButton`, not merely in a file that
      // happens to import the header. A screen that keeps its own button
      // beside a `<ScreenHeader>` passes an import test and is the bug.
      return !/<HeaderButton[\s\S]*?<ArrowLeftIcon/.test(code);
    });

    expect(rolled.map(name)).toEqual([]);
  });

  it("checked enough screens for that to mean something", () => {
    // Nine were converted. If this drops to nothing, the rule above is being
    // satisfied by an app with no back buttons in it.
    const withBack = screens.filter((rel) => /from "[^"]*ui\/ScreenHeader"/.test(codeOnly(read(rel))));
    expect(withBack.length).toBeGreaterThanOrEqual(12);
  });

  it("does not let a second header row grow beside the shared one", () => {
    /**
     * A screen may still lay out its own top row — a search field, a hero —
     * but it must not define the BUTTON. A `back:` style with its own box is
     * the exact thing that drifted, so the style itself is what is banned.
     */
    const ownButton = screens.filter((rel) => {
      if (HERO_OVERLAYS.includes(rel)) return false;

      return /\n\s*back\w*:\s*\{[^}]*width:/.test(codeOnly(read(rel)));
    });

    expect(ownButton.map(name)).toEqual([]);
  });
});

describe("colour comes from the theme, on every screen", () => {
  /**
   * THE TWO FILES THAT MAY WRITE A HEX, and both are palettes rather than
   * screens using one.
   *
   *   `tileArt`     — a hue per trade, light and dark stated as a pair. These
   *                   are pigments; there is no token for "bakery".
   *   `Onboarding`  — three full-bleed panel grounds, deeper than any token.
   *
   * Everything else reads `useColors()`. A hard-coded hex is a light-theme
   * value that will be wrong on a dark page — which is how Reservations ended
   * up putting a near-white pill on a near-black card.
   */
  const PALETTES = ["src/modules/marketplace/tileArt.tsx", "src/modules/onboarding/OnboardingScreen.tsx"];

  /** Pure white and pure black are not theme decisions; they are ink on a fill. */
  const NEUTRAL = /^#(fff|ffffff|000|000000)$/i;

  it("leaves no screen holding its own palette", () => {
    const offenders: string[] = [];

    for (const rel of screens) {
      if (PALETTES.includes(rel)) continue;
      const hexes = [...codeOnly(read(rel)).matchAll(/"(#[0-9a-fA-F]{3,8})"/g)]
        .map((m) => m[1])
        .filter((hex) => !NEUTRAL.test(hex));

      if (hexes.length > 0) offenders.push(`${name(rel)}: ${hexes.join(", ")}`);
    }

    expect(offenders).toEqual([]);
  });

  it("draws a reservation's status from the semantic tokens", () => {
    // The screen this rule was written for: ten fixed hexes, all of them the
    // light palette's, on a screen that renders in both themes.
    const code = codeOnly(read("src/modules/marketplace/screens/ReservationsScreen.tsx"));
    for (const token of ["c.warningBg", "c.infoBg", "c.successBg", "c.errorBg"]) {
      expect(code).toContain(token);
    }
  });

  it("does not paint the working side's colour on the shopping side's first screen", () => {
    // The onboarding panels are allowed their own hexes — but not THAT one.
    // `#e94e00` is the ember scale, which the rider app wears.
    const code = codeOnly(read("src/modules/onboarding/OnboardingScreen.tsx"));
    expect(code.toLowerCase()).not.toContain("#e94e00");
  });
});
