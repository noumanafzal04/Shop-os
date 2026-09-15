import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * THE FIRST TWO SCREENS ANYBODY SEES.
 *
 * ── The splash showed two colours ────────────────────────────────────
 *
 * "Splash py 2 colors arhy." The window Android paints before JavaScript
 * exists is `@color/brand` in `styles.xml` — a fixed orange. The splash then
 * painted `c.primary`, which is the THEME's primary, and the theme has two:
 * the shopping side is that orange and the rider side is green. So the frame
 * gave way to a green page and then to an orange app.
 *
 * The mistake is not the hex, it is ASKING. This screen is what the app shows
 * while it works out who you are — `modeKnown` is false for its whole life —
 * so a colour that depends on the answer cannot be right here.
 *
 * Reads source text: a lint rule wearing a test's clothes, because jsdom has
 * no layout engine and the colour is the only part that can be checked at all.
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

describe("the splash is one colour", () => {
  /**
   * The rule, stated as behaviour: it must not read the themed primary.
   */
  it("does not take its ground from the theme", () => {
    expect(splash).not.toMatch(/backgroundColor:\s*c\.primary/);
    expect(splash).not.toMatch(/color:\s*c\.onPrimary/);
  });

  it("takes it from the brand token instead", () => {
    expect(splash).toMatch(/BRAND_SCALE\[500\]/);
  });

  /**
   * …and that token is the same value the native window uses. Two places
   * hold this colour and they cannot read each other — a native resource
   * cannot see a TypeScript file — so the only thing that keeps them equal is
   * a check that they are.
   */
  it("is the same colour Android paints before JavaScript exists", () => {
    const native = colors.match(/<color name="brand">(#[0-9a-fA-F]{6})<\/color>/)?.[1];
    expect(native).toBeDefined();

    // RAW, not `codeOnly` — the line is identified by the comment on it
    // ("// the primary"), and stripping comments takes the landmark away. The
    // first version of this test did that and failed on its own helper.
    const tokens = fs.readFileSync(path.join(PROJECT_ROOT, "src/theme/tokens.ts"), "utf8");
    const token = tokens.match(/500:\s*"(#[0-9a-fA-F]{6})",\s*\/\/ the primary/)?.[1];
    expect(token).toBeDefined();

    expect(token!.toLowerCase()).toBe(native!.toLowerCase());
    // And the window actually uses it, rather than defaulting to white.
    expect(styles).toMatch(/windowBackground">@color\/brand/);
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
