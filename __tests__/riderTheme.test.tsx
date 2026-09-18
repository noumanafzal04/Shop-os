import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { PROJECT_ROOT, fs, path } from "./support/node";
import { ThemeProvider, useColors } from "../src/theme";
import { lightColors, darkColors, emeraldLightColors, emeraldDarkColors } from "@cartze/core/theme/themes";
import { useModeStore } from "../src/stores/modeStore";
import { useModePalettes } from "../src/modules/mode/palettes";

jest.mock("../src/common/utils/prefs", () => ({
  prefs: {
    all: jest.fn(async () => ({})),
    setMode: jest.fn(async () => {}),
    setTheme: jest.fn(async () => {}),
    setOnboarded: jest.fn(async () => {}),
  },
}));

/**
 * THE WORKING SIDE HAS ITS OWN COLOUR.
 *
 * "rider ka theme seprate kro." Same app, same shapes, one hue swapped — and
 * the reason is not decoration. Two navigators that look identical is a rider
 * who is not certain which one they are in; a hue is readable across a room.
 *
 * Green because it is already this app's word for "go": it is what `success`
 * is drawn in, and what the online toggle turns when a shift starts. A red
 * button sitting beside a green "online" pill was the whole screen disagreeing
 * with the one control that matters most on it.
 */

const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Contrast, so "readable" is measured rather than asserted. */
const lum = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Hue, in degrees — the OTHER way two colours are told apart, and the one a
 * contrast ratio is blind to. See the refusal case below for what that
 * blindness cost.
 */
const hueOf = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;

  return (h * 60 + 360) % 360;
};

describe("the two palettes are actually different", () => {
  it("gives the rider a different primary in both themes", () => {
    expect(emeraldLightColors.primary).not.toBe(lightColors.primary);
    expect(emeraldDarkColors.primary).not.toBe(darkColors.primary);
    expect(emeraldLightColors.brand[500]).not.toBe(lightColors.brand[500]);
  });

  it("changes ONLY the brand, so this stays one app", () => {
    // The greys, the surfaces, the borders, the type and the spacing are
    // shared on purpose. A second full design is a second thing to keep in
    // step, and it drifts.
    const moved = (Object.keys(lightColors) as Array<keyof typeof lightColors>).filter(
      (k) => JSON.stringify(lightColors[k]) !== JSON.stringify(emeraldLightColors[k]),
    );
    /**
     * Four of these are the brand itself. The other three are corrections the
     * brand FORCES, and each is measured rather than preferred:
     *
     *   onPrimary  white on #10b981 is 2.54:1 — under even the 3:1 floor for
     *              a UI component. Ink on it is 6.91:1.
     *   error      the carmine side's brand IS red, so its refusals had to
     *              move deeper; the emerald side has no such problem and
     *              takes the true red back.
     *   errorBg    follows `error`, or a tinted notice stops matching its own
     *              text.
     *
     * The list is spelled out so that a FOURTH divergence has to be argued
     * for here rather than added quietly — which is how one app becomes two.
     */
    expect(moved.sort()).toEqual([
      "brand",
      "error",
      "errorBg",
      "onPrimary",
      "primary",
      "primaryPressed",
      "primarySoft",
    ]);
  });

  it("carries a label on the rider's primary, which the customer's does not", () => {
    /**
     * ASKED AGAINST THE LABEL'S OWN COLOUR, and that is the point.
     *
     * This used to compare the primary to a hardcoded "#ffffff", which was
     * true of every palette this app had ever had — until #10b981 arrived,
     * measured 2.54:1 against white, and the fix was not to reject the colour
     * but to stop putting white on it. A test naming the label colour itself
     * would have failed for the right reason and reported the wrong one.
     *
     * So: whatever a palette says sits ON its primary must actually be
     * readable there. #10b981 with ink is 6.91:1.
     */
    expect(
      contrast(emeraldLightColors.primary, emeraldLightColors.onPrimary),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(emeraldDarkColors.primary, emeraldDarkColors.onPrimary),
    ).toBeGreaterThanOrEqual(4.5);

    /**
     * The carmine side pays the brand's own cost, knowingly: #ef4444 on white
     * is 3.76:1 — a large bold label and icons, never body text. The same
     * stated cost the brand has carried since it was #e94e00 at 3.78:1.
     */
    expect(contrast(lightColors.primary, lightColors.onPrimary)).toBeGreaterThanOrEqual(3);
    expect(contrast(lightColors.primary, lightColors.onPrimary)).toBeLessThan(4.5);
  });

  it("goes brighter rather than darker for a pressed control on a dark page", () => {
    // The same rule the customer's dark scale follows: on a dark ground the
    // only direction left is up, so a pressed button lifts instead of sinking.
    expect(lum(emeraldDarkColors.primaryPressed)).toBeGreaterThan(lum(emeraldDarkColors.primary));
    expect(lum(emeraldLightColors.primaryPressed)).toBeLessThan(lum(emeraldLightColors.primary));
  });

  it("keeps a refusal from looking like the brand", () => {
    /**
     * TOLD APART BY HUE **OR** BY LIGHTNESS — and the first draft of this
     * guard got the instrument wrong, which is worth leaving written down.
     *
     * It asked for a contrast RATIO between the two. Contrast ratio measures
     * luminance, so it rates pink #f472b6 against red #f87171 at 1.04:1 —
     * "identical" — when no one would confuse them. A guard that cannot see
     * a hue difference will happily reject the fix and accept the bug.
     *
     * The bug it exists for: the carmine brand is red, and `error` was
     * #d92d20 — **4° apart in hue and 1.28:1 in luminance**, which is the
     * same colour twice. The palette's own older comment had it right all
     * along: "at hue 4 against the brand's 20 they are told apart at a
     * glance". That sentence was true when the brand was orange, and became
     * false without anybody editing it.
     */
    const apart = (a: string, b: string) => {
      const d = Math.abs(hueOf(a) - hueOf(b));
      return Math.min(d, 360 - d);
    };
    const distinct = (a: string, b: string) => apart(a, b) >= 12 || contrast(a, b) >= 1.8;

    expect(distinct(lightColors.primary, lightColors.error)).toBe(true);
    expect(distinct(darkColors.primary, darkColors.error)).toBe(true);
    // The emerald side has it easy — a green brand leaves red free, 156° away.
    expect(distinct(emeraldLightColors.primary, emeraldLightColors.error)).toBe(true);
    expect(distinct(emeraldDarkColors.primary, emeraldDarkColors.error)).toBe(true);
  });

  it("keeps the soft tint readable in each theme", () => {
    /**
     * A MARK ON THE TINT, drawn in whatever brand shade the palette says is
     * readable — `primaryPressed`, not necessarily `primary`.
     *
     * The distinction is not pedantry. #10b981 on its own pale tint is
     * 2.41:1, and this app has already shipped that mistake once with a
     * different green: `CustomerHomeScreen` still carries the note
     * "primarySoft behind a brand glyph measured 1.4:1 and read as disabled".
     * The carmine side has no such problem — #ef4444 on #fef2f2 is 3.44:1 —
     * which is exactly why the rule has to be asked of each palette rather
     * than assumed from the one that happens to pass.
     */
    expect(
      contrast(emeraldLightColors.primarySoft, emeraldLightColors.primaryPressed),
    ).toBeGreaterThan(3);
    expect(
      contrast(emeraldDarkColors.primarySoft, emeraldDarkColors.primaryPressed),
    ).toBeGreaterThan(3);
    expect(contrast(lightColors.primarySoft, lightColors.primaryPressed)).toBeGreaterThan(3);
    expect(contrast(darkColors.primarySoft, darkColors.primaryPressed)).toBeGreaterThan(3);
  });
});

/**
 * THE APP DECIDES THE PALETTE, NOT THE PROVIDER.
 *
 * These cases used to mount a bare `<ThemeProvider>` and expect it to read
 * `modeStore` itself. It did — and that single import was the one thing
 * keeping the whole theme layer tied to THIS app: a mode is a shopper who is
 * sometimes a rider, and no other app has one.
 *
 * The provider now takes `paletteFor`; `useModePalettes` is the only file in
 * the product that knows the mapping, and `App.tsx` wires the two together.
 * So the test mounts what the app mounts. The rule being checked has not
 * changed by a word — the shopping side is green and the working side is
 * red — only where the answer comes from.
 */
/**
 * THE PALETTE IS ONLY HALF THE CONTRACT.
 *
 * The cases above prove a palette's `onPrimary` is readable on its `primary`.
 * They say nothing about whether anything USES it — and for a while nothing
 * did: `AppButton` drew `c.white` on every solid button, which was true of
 * every palette this product had until #10b981 arrived at 2.54:1 against
 * white. Eight hundred and forty tests passed. It took running the app to see
 * a sign-in button whose label nobody could read.
 *
 * "Promise in another file" is the name this codebase already has for it: a
 * rule stated in one place and implemented in none.
 */
describe("the components actually read the palette", () => {
  const source = (file: string) =>
    fs.readFileSync(path.join(__dirname, "..", "..", "core", "src", "ui", file), "utf8");

  it("draws a solid button's label with onPrimary, never a hardcoded white", () => {
    const button = codeOnly(source("AppButton.tsx"));

    expect(button).toContain("c.onPrimary");
    // `c.white` on a solid ground is the exact bug. It may still appear for
    // `danger`, whose red is dark enough on both themes and is not a hue a
    // palette re-points — so the assertion is about the PRIMARY branch.
    expect(button).not.toMatch(/variant === "primary"[\s\S]{0,40}c\.white/);
    expect(button).not.toMatch(/solid \?\s*c\.white/);
  });

  it("fills a primary button from `primary`, not from a scale index", () => {
    // `brand[500]` and `primary` agree today. An index is a fact about a
    // scale; `primary` is a fact about the design, and only one of them
    // survives the next repalette.
    expect(codeOnly(source("AppButton.tsx"))).toMatch(/primary:\s*\{\s*backgroundColor:\s*c\.primary/);
  });

  it("does not disable a button by halving its contrast", () => {
    /**
     * `opacity: 0.5` faded the fill AND the label together. On a button whose
     * label was already at 2.54:1 the result was unreadable, and on any
     * palette it makes "not ready yet" look like "broken".
     */
    expect(codeOnly(source("AppButton.tsx"))).not.toMatch(/disabled:\s*\{\s*opacity:\s*0\.5\s*\}/);
  });
});

describe("the app paints the side you are on", () => {
  function Probe({ onColor }: { onColor: (hex: string) => void }) {
    const c = useColors();
    onColor(c.primary);
    return null;
  }

  /** What `App.tsx` mounts, in miniature. */
  function Themed({ onColor }: { onColor: (hex: string) => void }) {
    const palettes = useModePalettes();

    return (
      <ThemeProvider
        paletteFor={palettes.paletteFor}
        oppositePaletteFor={palettes.oppositePaletteFor}
      >
        <Probe onColor={onColor} />
      </ThemeProvider>
    );
  }

  const paint = async () => {
    let hex = "";
    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(<Themed onColor={(h) => (hex = h)} />);
    });
    return hex;
  };

  afterEach(() => useModeStore.setState({ mode: "customer", switching: false, target: null }));

  it("paints the shopping side green", async () => {
    // Which side wears which has been turned over twice. The palettes are
    // named for their COLOURS — `carmine`, `emerald` — so this is the only
    // line that decides it, and it can move again without a rename.
    useModeStore.setState({ mode: "customer" });
    expect(await paint()).toBe(emeraldLightColors.primary);
  });

  it("paints the working side in the brand's carmine", async () => {
    useModeStore.setState({ mode: "rider" });
    expect(await paint()).toBe(lightColors.primary);
  });

  it("gives the two sides genuinely different colours, whichever way round", async () => {
    // The rule that survives the swap: two navigators that look identical is a
    // rider who is not certain which one they are in.
    useModeStore.setState({ mode: "customer" });
    const shopping = await paint();
    useModeStore.setState({ mode: "rider" });
    expect(await paint()).not.toBe(shopping);
  });
});

describe("a rider's account page is a rider's", () => {
  const account = codeOnly(
    fs.readFileSync(path.join(PROJECT_ROOT, "src/modules/account/screens/AccountScreen.tsx"), "utf8"),
  );

  it("asks which half of the app it is in", () => {
    // `RiderAccountTab` renders THIS screen, so without asking it offered
    // somebody mid-delivery their favourites and their table bookings.
    expect(account).toMatch(/const onShift = useModeStore\(/);
  });

  it("offers the board, the money and the paperwork instead of shopping", () => {
    expect(account).toMatch(/const RIDER_WORK: Link\[\]/);
    const list = account.slice(account.indexOf("const RIDER_WORK"), account.indexOf("const APP:"));
    expect(list).toMatch(/My deliveries/);
    expect(list).toMatch(/Earnings/);
    expect(list).toMatch(/Rider account/);
  });

  it("hides the shopping rows on shift, and the rider invitation off it", () => {
    expect(account).toMatch(/\{onShift \? \(/);
    // "Earn with us" invites somebody who is not already earning.
    expect(account).toMatch(/\{!onShift && \(/);
  });

  it("still shows a rider the rows that are about the PERSON", () => {
    // The denominator, and the rule: a rider is the same person with a
    // different job. Profile, security and notifications do not move.
    expect(account).toMatch(/<Text style=\{styles\.section\}>My account<\/Text>/);
    const me = account.slice(account.indexOf("const ME:"), account.indexOf("const ORDERING:"));
    expect(me).toMatch(/Profile/);
    expect(me).toMatch(/Security/);
  });
});
