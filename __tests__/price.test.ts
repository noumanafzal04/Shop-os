import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import { hasCut, percentOff } from "../src/common/ui/Price";
import { shopCover } from "../src/modules/marketplace/shopCover";

/**
 * THE PRICE, THE CUT, AND THE OFFER THE APP USED TO INVENT.
 *
 * "price show krwa discount price kaise kro gy?" — and the honest answer, when
 * the code was read rather than the intent recalled, was: five ways, one of
 * them wrong on every screen.
 */

describe("a strike-through is a claim, and it has to be true", () => {
  it("says nothing when there is no regular price", () => {
    expect(hasCut(300, null)).toBe(false);
    expect(hasCut(300, undefined)).toBe(false);
    expect(percentOff(300, null)).toBeNull();
  });

  it("refuses to strike a price through against itself", () => {
    // THE BUG. Every one of the five copies drew the strike on
    // `original_price != null`, so a shop that fills the regular price in
    // without running a sale had "Rs 300 / Rs 300 struck through" printed
    // beside its item — an offer the app made up, in the shop's name.
    expect(hasCut(300, 300)).toBe(false);
    expect(percentOff(300, 300)).toBeNull();
  });

  it("refuses a regular price BELOW what is being charged", () => {
    // A price rise is not a discount. Struck through it reads as one.
    expect(hasCut(350, 300)).toBe(false);
    expect(percentOff(350, 300)).toBeNull();
  });

  it("shows one when the cut is real", () => {
    expect(hasCut(250, 300)).toBe(true);
    expect(percentOff(250, 300)).toBe(17);
  });

  it("reads the decimal STRINGS Laravel actually sends", () => {
    // `price` is a decimal column and arrives as "250.00". A comparison of
    // "250.00" against 300 by `<` would work by coercion and `"300.00" > "50.00"`
    // would not — string comparison is lexicographic. Numbers, both sides.
    expect(hasCut("250.00", "300.00")).toBe(true);
    expect(hasCut("300.00", "300.00")).toBe(false);
    expect(percentOff("250.00", "300.00")).toBe(17);
  });

  it("survives a price that is not a number at all", () => {
    expect(hasCut(NaN, 300)).toBe(false);
    expect(hasCut("free", 300)).toBe(false);
    expect(percentOff(250, 0)).toBeNull();
  });
});

describe("a badge that says nothing is not drawn", () => {
  it("suppresses a cut that rounds to zero per cent", () => {
    // One rupee off three hundred is a third of a per cent, and the home card
    // drew `Math.round(...)` inline — "0% off", in amber, on a photograph.
    expect(percentOff(299, 300)).toBeNull();
  });

  it("keeps the smallest cut anybody would call one", () => {
    expect(percentOff(198, 200)).toBe(1);
  });

  it("rounds rather than truncates", () => {
    // 33.33% is "33% off", not "34%" and not "33.333333%".
    expect(percentOff(200, 300)).toBe(33);
  });
});

/** Comments stripped — prose ABOUT a rupee string is not a rupee string. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("everything that draws a price goes through the one component", () => {
  const files = sourceFiles(path.join(PROJECT_ROOT, "src"));

  it("does not read its own documentation as code", () => {
    // The first run of the scan below reported this file's own docblock, which
    // QUOTES the pattern it forbids. A detector that cannot tell a rule from a
    // description of a rule fails on the commit that writes the rule down.
    expect(codeOnly('/* was `Rs ${n}` */\nconst x = 1;')).not.toMatch(/Rs \$\{/);
    expect(codeOnly('const t = `Rs ${n}`;')).toMatch(/Rs \$\{/);
  });

  it("scanned the app", () => {
    // A count of findings is not evidence without a count of attempts.
    expect(files.length).toBeGreaterThan(30);
  });

  it("has exactly one strike-through in the whole app", () => {
    const offenders = files
      .filter((f) => !f.endsWith("common/ui/Price.tsx"))
      .flatMap((f) =>
        codeOnly(fs.readFileSync(f, "utf8"))
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /textDecorationLine:\s*"line-through"/.test(line))
          .map(([n]) => `  ${path.relative(PROJECT_ROOT, f)}:${n}`),
      );

    expect(offenders.join("\n")).toBe("");
  });

  it("never builds a rupee string by hand", () => {
    // Two screens wrote `Rs {n.toLocaleString()}` — a sixth and seventh copy of
    // a formatter that lives in one file precisely because a decimal STRING
    // from the server comes out of the wrong one as "Rs NaN".
    const offenders = files
      .filter((f) => !f.endsWith("common/format.ts"))
      .flatMap((f) =>
        codeOnly(fs.readFileSync(f, "utf8"))
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /Rs \{|"Rs " \+|`Rs \$\{/.test(line))
          .map(([n, line]) => `  ${path.relative(PROJECT_ROOT, f)}:${n}  ${line.trim()}`),
      );

    expect(offenders.join("\n")).toBe("");
  });
});

describe("a shop without a photograph is not a dark hole", () => {
  /** Perceived luminance, 0 (black) to 1 (white). */
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

  /** Every distinct cover the palette can produce, in one theme. */
  const allCovers = (dark: boolean) => {
    const seen = new Map<string, { bg: string; fg: string }>();
    for (let i = 0; i < 400; i++) {
      const cover = shopCover(`shop-${i}`, dark);
      seen.set(cover.bg, cover);
    }
    return [...seen.values()];
  };

  it("reaches every tone in the set", () => {
    // The denominator. If the hash collapsed onto one bucket, the assertions
    // below would pass by only ever measuring one colour.
    expect(allCovers(false)).toHaveLength(6);
    expect(allCovers(true)).toHaveLength(6);
  });

  it("draws no shop card darker than the page it is on", () => {
    // The complaint: "cards py bht dark color use kia huwa jinki images ni /
    // app bht dark dark feel ho rhi". Two of the six old tones were #983405
    // and #221711 — a third of a marketplace where almost nobody has uploaded
    // a logo came out near-black, on a white screen.
    //
    // Measured against the app's own surface rather than against a number
    // somebody liked: a placeholder standing in for a photograph must be
    // LIGHTER than mid-grey, or it reads as a hole in the card.
    const heavy = allCovers(false).filter((t) => lum(t.bg) < 0.45);
    expect(heavy.map((t) => t.bg).join(", ")).toBe("");
  });

  it("and no dark-theme cover brighter than the card it sits on", () => {
    // The same mistake in the other direction: six pale washes on a near-black
    // page is a page full of glare.
    const glaring = allCovers(true).filter((t) => lum(t.bg) > 0.25);
    expect(glaring.map((t) => t.bg).join(", ")).toBe("");
  });

  it("keeps the letter readable on every ground, in both themes", () => {
    for (const dark of [false, true]) {
      for (const t of allCovers(dark)) {
        expect({ ...t, ratio: +contrast(t.bg, t.fg).toFixed(2) }).toMatchObject({
          ratio: expect.any(Number),
        });
        expect(contrast(t.bg, t.fg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("gives one shop the same colour every time it is asked", () => {
    // The whole reason it is derived rather than random: a shop that changes
    // colour between the rail and the card is two shops to the eye.
    expect(shopCover("burger-lab")).toEqual(shopCover("burger-lab"));
    expect(shopCover("burger-lab").bg).not.toBe(shopCover("burger-lab", true).bg);
  });

  it("still separates two shops with nearly the same slug", () => {
    // djb2 rather than a character sum, which gave these two the same tone.
    expect(shopCover("sweep-mart").bg).not.toBe(shopCover("sweep-food").bg);
  });
});
