import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { PROJECT_ROOT, fs, path } from "./support/node";
import { ThemeProvider, useColors } from "../src/theme";
import { lightColors, darkColors, riderLightColors, riderDarkColors } from "../src/theme/themes";
import { useModeStore } from "../src/stores/modeStore";

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

describe("the two palettes are actually different", () => {
  it("gives the rider a different primary in both themes", () => {
    expect(riderLightColors.primary).not.toBe(lightColors.primary);
    expect(riderDarkColors.primary).not.toBe(darkColors.primary);
    expect(riderLightColors.brand[500]).not.toBe(lightColors.brand[500]);
  });

  it("changes ONLY the brand, so this stays one app", () => {
    // The greys, the surfaces, the borders, the type and the spacing are
    // shared on purpose. A second full design is a second thing to keep in
    // step, and it drifts.
    const moved = (Object.keys(lightColors) as Array<keyof typeof lightColors>).filter(
      (k) => JSON.stringify(lightColors[k]) !== JSON.stringify(riderLightColors[k]),
    );
    expect(moved.sort()).toEqual(["brand", "primary", "primaryPressed", "primarySoft"]);
  });

  it("carries a label on the rider's primary, which the customer's does not", () => {
    /**
     * #E94E00 is about 3.1:1 against white — fine for a large bold label and
     * stated as a known cost in the palette for the brand's own hue.
     *
     * There is no brand reason to pay that twice, and a rider reads this
     * outdoors on a bike. The first green tried here was the palette's own
     * green[500], which measures 4.11 — close enough to look fine on a desk
     * and NOT AA, which is exactly the sort of number that gets asserted from
     * memory. Measured, then chosen.
     */
    expect(contrast(riderLightColors.primary, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    // …and the customer's, for the contrast between the two claims.
    expect(contrast(lightColors.primary, "#ffffff")).toBeLessThan(4.5);
  });

  it("goes brighter rather than darker for a pressed control on a dark page", () => {
    // The same rule the customer's dark scale follows: on a dark ground the
    // only direction left is up, so a pressed button lifts instead of sinking.
    expect(lum(riderDarkColors.primaryPressed)).toBeGreaterThan(lum(riderDarkColors.primary));
    expect(lum(riderLightColors.primaryPressed)).toBeLessThan(lum(riderLightColors.primary));
  });

  it("keeps the soft tint readable in each theme", () => {
    expect(contrast(riderLightColors.primarySoft, riderLightColors.primary)).toBeGreaterThan(3);
    expect(contrast(riderDarkColors.primarySoft, riderDarkColors.primary)).toBeGreaterThan(3);
  });
});

describe("the provider follows the mode", () => {
  function Probe({ onColor }: { onColor: (hex: string) => void }) {
    const c = useColors();
    onColor(c.primary);
    return null;
  }

  const paint = async () => {
    let hex = "";
    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ThemeProvider>
          <Probe onColor={(h) => (hex = h)} />
        </ThemeProvider>,
      );
    });
    return hex;
  };

  afterEach(() => useModeStore.setState({ mode: "customer", switching: false, target: null }));

  it("paints the shopping side in the brand", async () => {
    useModeStore.setState({ mode: "customer" });
    expect(await paint()).toBe(lightColors.primary);
  });

  it("paints the working side in the rider's own colour", async () => {
    useModeStore.setState({ mode: "rider" });
    expect(await paint()).toBe(riderLightColors.primary);
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
