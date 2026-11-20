import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";
import { carmineThemes, meadowThemes } from "../../core/src/theme/themes";

/**
 * "ON CART SCREEN ADD MORE MONEY TO FREE DELIVERY BANNER NOT SHOWING PROPERLY
 * — VERY LIGHT BG AND TEXT WHITE."
 *
 * `onWarm` is the ink for the SOLID deal fill. The teal theme set it white —
 * right on orange — and six places used it on the PALE `warmSoft` ground: the
 * cart nudge, the order OTP, the rating chip, three rider cash cards. White on
 * peach. They now take `onWarmSoft`, and every theme's pairs are measured.
 */
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

const all = [
  ...Object.entries(carmineThemes).map(([k, t]) => [`carmine ${k}`, t] as const),
  ...Object.entries(meadowThemes).map(([k, t]) => [`teal ${k}`, t] as const),
];

describe("ink on the deal colours", () => {
  it.each(all)("%s: text on the pale deal ground reads (4.5:1)", (_name, t) => {
    expect(contrast(t.onWarmSoft, t.warmSoft)).toBeGreaterThanOrEqual(4.5);
  });

  it("the pale ground never takes the solid fill's ink", () => {
    const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));
    const pairs: Array<[string, RegExp]> = [
      ["src/modules/orders/screens/CartScreen.tsx", /nudgeDealText: \{[^}]*color: c\.onWarmSoft/],
      ["src/modules/orders/screens/OrderTrackingScreen.tsx", /otpCode: \{[^}]*color: c\.onWarmSoft/],
      ["src/modules/marketplace/components/RatingChip.tsx", /text: \{[^}]*color: c\.onWarmSoft/],
      ["src/modules/rider/screens/RiderHomeScreen.tsx", /cashText: \{[^}]*color: c\.onWarmSoft/],
      ["src/modules/rider/screens/RiderEarningsScreen.tsx", /cashValue: \{[^}]*color: c\.onWarmSoft/],
    ];
    for (const [rel, rule] of pairs) expect(read(rel)).toMatch(rule);
  });
});
