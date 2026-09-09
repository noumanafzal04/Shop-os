import { BRAND } from "../src/common/brand";
import { PROJECT_ROOT, blockAt, codeOnly, fs, path } from "./support/node";

/**
 * THE WORKING SIDE'S OWN FRONT PAGE.
 *
 * ── What was reported ────────────────────────────────────────────────
 *
 * "Rider side main screen attractive ni hai / branding show nii ho rhi."
 *
 * The board wore a plain `ScreenHeader` — a white bar with the word "Rider" on
 * it — while the shopping side opens on a full-width coloured hero with a
 * location picker and a search bar in it. Two halves of one app that did not
 * look related, and the working half was the one that looked unfinished.
 *
 * Nothing anywhere on it said what app it was, which matters more here than on
 * the shopping side: that side is opened from a launcher icon, and this one is
 * entered by SWITCHING MODE from inside the same app. "Am I in the right
 * place" is the only question the top of this screen has to answer.
 */

const src = codeOnly(
  fs.readFileSync(
    path.join(PROJECT_ROOT, "src/modules/rider/screens/RiderHomeScreen.tsx"),
    "utf8",
  ),
);

describe("the rider board says what app it is", () => {
  it("draws the wordmark", () => {
    expect(src).toMatch(/<Text style=\{styles\.wordmark\}>\{BRAND\.name\}<\/Text>/);
  });

  it("takes the name from BRAND, never a literal", () => {
    // A rename is one edit in `brand.ts`. A screen that spelled it out would
    // be a screen that keeps the old name for ever, and this is the most
    // visible string on the page.
    expect(src).not.toMatch(new RegExp(`"${BRAND.name}"`));
    expect(src).toMatch(/BRAND\.name/);
  });

  it("says which side of the app this is, as a qualifier", () => {
    // A chip, not a second word: "CartZe Rider" set in one face reads as a
    // two-word product name rather than as one product with two sides.
    expect(src).toMatch(/styles\.modeChip/);
    expect(src).toMatch(/>RIDER</);
  });

  it("shows the code a shop types to add this rider", () => {
    // It is read out on a phone call, which is a bad moment to go hunting
    // through a menu for it.
    expect(src).toMatch(/rider\.data\?\.rider_code/);
    expect(src).toMatch(/styles\.riderCode/);
  });
});

describe("the hero, and what it replaced", () => {
  it("leaves the notch to the page and the icons to the phone's theme", () => {
    /**
     * ── THE BAND THIS USED TO ASSERT ────────────────────────────────
     *
     * The hero was a solid ember slab that painted the status-bar area itself:
     * `edges={["bottom"]}` dropped the top inset on purpose and the status bar
     * was pinned to `light-content`.
     *
     * Reported as "top notch issue" and "primary color should be white as was
     * first". A full-bleed colour field behind the clock and the camera
     * cut-out is the loudest thing on the screen, and it was loudest on the
     * one screen a rider stares at all day.
     *
     * So the top inset is back, and the icon polarity follows the PHONE rather
     * than the brand — `light-content` on a white header is invisible.
     */
    expect(src).toMatch(/edges=\{\["top", "bottom"\]\}/);
    expect(src).toMatch(/style=\{isDark \? "light-content" : "dark-content"\}/);
    expect(src).not.toMatch(/backgroundColor=\{c\.brand\[600\]\}/);
  });

  it("does not wear the plain header on the board any more", () => {
    /**
     * `ScreenHeader` is still imported and still used — the not-approved gate
     * and the load-failure screen both keep it, because neither is a hero and
     * a coloured band over an error message is decoration.
     *
     * So the check is that the BOARD is not one of its callers: the hero and
     * the plain header must not both be drawn, which is what a half-finished
     * edit leaves behind.
     */
    expect(src).toMatch(/<ScreenHeader/);
    expect(src).not.toMatch(/<ScreenHeader\s+title="Rider"\s+subtitle=/);
  });

  it("makes going on duty the largest thing on the screen", () => {
    // It was a bordered card the same size and weight as the three stat tiles
    // under it, so the one control that decides whether the screen does
    // anything looked like a row in a list.
    expect(src).toMatch(/style=\{\[styles\.duty, online && styles\.dutyOn\]\}/);
    // And it is inside the hero, not below it.
    const hero = src.indexOf("styles.hero");
    const duty = src.indexOf("styles.duty");
    const stats = src.indexOf("styles.stats");
    expect(hero).toBeGreaterThan(-1);
    expect(duty).toBeGreaterThan(hero);
    expect(stats).toBeGreaterThan(duty);
  });

  it("keeps duty state readable without relying on colour", () => {
    // A red dot and a green dot at 9px are the same dot to most eyes, and
    // colour alone is never an accessible cue. Hollow ring off, filled on.
    expect(src).toMatch(/styles\.dutyDot, online && styles\.dutyDotOn/);
  });

  it("spends the brand colour on the state, and on the wordmark", () => {
    /**
     * "Just show branding color." Two places, and both of them say something:
     * the wordmark, which answers "am I on the rider side", and the duty card,
     * which is the only filled thing on the page — so the fill IS the state,
     * readable across a room.
     *
     * Bounded to the style declarations so a `c.primary` on an icon somewhere
     * cannot pass this on the card's behalf.
     */
    expect(blockAt(src, "    wordmark: {")).toMatch(/color: c\.primary/);
    expect(blockAt(src, "    dutyOn: {")).toMatch(/backgroundColor: c\.primary/);
    // And the rest of the page is the page. One filled thing, not four.
    expect(blockAt(src, "    hero: {")).toMatch(/backgroundColor: c\.bg/);
    expect(blockAt(src, "    duty: {")).toMatch(/backgroundColor: c\.surface/);
  });
});

describe("the list still owns its own margin", () => {
  it("drops the content container's horizontal padding", () => {
    // The hero is inside `ListHeaderComponent` and has to reach both screen
    // edges, so the inset moved onto the rows. Left on the container, the band
    // would float with 16pt of page colour down each side.
    expect(src).toMatch(/list: \{ paddingBottom: spacing\.xxl, gap: spacing\.xs \}/);
    expect(src).toMatch(/inset: \{ paddingHorizontal: spacing\.md \}/);
  });

  it("gives every row and caption that inset back", () => {
    /**
     * The half that is easy to forget: a hero that reaches the edge and rows
     * that follow it there is one screen with no margins at all.
     *
     * Named one by one rather than counted. A count is a weaker test AND a
     * wrong one — my first version of this expected five and got four, because
     * the style's own declaration is `inset:` and not `styles.inset`, so the
     * assertion was really about the regex.
     */
    // Both captions.
    expect(src.match(/\[styles\.caption, styles\.inset\]/g) ?? []).toHaveLength(2);
    // The carrying-now group, which needs the list's old `gap` back with it.
    expect(src).toMatch(/style=\{\[styles\.inset, styles\.stack\]\}/);
    // And every offer row.
    expect(src).toMatch(/<View style=\{styles\.inset\}>\s*<JobCard job=\{item\}/);
  });
});

describe("the refresh control", () => {
  it("has no variant left for a band that no longer exists", () => {
    /**
     * The pill had an `onDark` mode for the ember band. The band is gone, so
     * the prop had no caller — and a prop with no caller is a second
     * appearance of a control that nobody maintains and no screen proves.
     * Same rule as `reachable.test.ts`: kept "for later" is how a codebase
     * accumulates styles that were correct for a design it no longer has.
     */
    const pill = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/common/ui/RefreshPill.tsx"), "utf8"),
    );
    expect(pill).not.toMatch(/onDark\?: boolean/);
    expect(pill).not.toMatch(/pillOnDark:/);
    expect(src).not.toMatch(/onDark/);
  });

  it("is one component wherever it is drawn", () => {
    // The words and the spin behaviour are the part worth having one copy of.
    const pill = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/common/ui/RefreshPill.tsx"), "utf8"),
    );
    expect(pill).toMatch(/export function RefreshPill/);
    expect(pill).toMatch(/export function ago/);
  });
});
