import { describe, expect, it } from "vitest";

import { code128BarsSvg, code128ModuleCount, code128Svg } from "./code128";

/**
 * A barcode is a string somebody typed, and these functions turn it into markup
 * that is rendered through `dangerouslySetInnerHTML`.
 *
 * That combination is the whole reason this file has tests. Code 128-B covers
 * every printable ASCII character — `<`, `>` and `"` among them — so a barcode
 * is not a safe alphabet, it is arbitrary text. It can arrive from a product
 * form or from a supplier's CSV import, and it is printed on a label sheet by
 * whoever runs the shop.
 */

const HOSTILE = '</text><script>alert(1)</script>';

describe("what reaches the markup", () => {
  it("never lets a barcode's own characters into the label text", () => {
    const svg = code128Svg(HOSTILE, { showText: true });

    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;/text&gt;&lt;script&gt;");
  });

  it("escapes quotes too, which is where an attribute would be broken out of", () => {
    expect(code128Svg('a"b', { showText: true })).toContain("a&quot;b");
  });

  it("escapes the ampersand, or the escaping itself can be undone", () => {
    // `&lt;` written as `&amp;lt;` is the difference between showing a
    // character and re-introducing one.
    expect(code128Svg("a&lt;b", { showText: true })).toContain("a&amp;lt;b");
  });

  it("leaves an ordinary barcode readable", () => {
    // The escaping must not be the kind that ships and then gets reverted
    // because it mangled every real label.
    expect(code128Svg("MILK-1L-004", { showText: true })).toContain(">MILK-1L-004<");
  });

  it("prints no text at all when the caller asked for none", () => {
    expect(code128Svg(HOSTILE, { showText: false })).not.toContain("<text");
  });

  it("keeps the bars-only variant free of the input entirely", () => {
    // It never prints the string, so the only thing to prove is that the
    // string cannot get in by another door.
    const svg = code128BarsSvg(HOSTILE);

    expect(svg).not.toContain("script");
    expect(svg).not.toContain("alert");
    expect(svg).toContain("<rect");
  });
});

describe("still a barcode afterwards", () => {
  it("encodes something a scanner could read", () => {
    // The escaping sits next to the encoder; a change that broke the symbol
    // would be invisible until a label came off the printer.
    expect(code128BarsSvg("ABC123")).toMatch(/<rect x="\d+"/);
    expect(code128ModuleCount("ABC123")).toBeGreaterThan(0);
  });

  it("widens with the string, so the label maths still holds", () => {
    expect(code128ModuleCount("ABCDEFGH")).toBeGreaterThan(code128ModuleCount("AB"));
  });
});

/**
 * THE BARS THEMSELVES.
 *
 * The four patterns below were not produced by this encoder: they are what a
 * different library (python-barcode) writes for the same values, and each was
 * read back by a decoder written without reference to either. A test that only
 * compared this encoder with itself would pass for any consistent mistake.
 *
 * And they are read off the DRAWING — the rectangles in the SVG a label is
 * printed from — the way a scanner reads a sticker, not out of the encoder's
 * own working. A pattern that was right and then drawn wrong would be a
 * sticker that does not scan.
 */
function code128Modules(value: string): string {
  const svg = code128BarsSvg(value);
  const width = Number(/viewBox="0 0 (\d+) 100"/.exec(svg)?.[1]);
  const modules = Array.from({ length: width }, () => "0");

  for (const bar of svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)) {
    for (let i = 0; i < Number(bar[2]); i++) modules[Number(bar[1]) + i] = "1";
  }

  // Ten blank modules either side are the quiet zone, not the symbol.
  return modules.slice(10, width - 10).join("");
}

describe("the bars a scanner reads", () => {
  const SOMEBODY_ELSES: Record<string, string> = {
      "123456": "11010011100101100111001000101100011100010110100011011101100011101011",
      "8961230000011": "110100111001101101111011001000010111011011101101100110011011001100110011011001011110111010011100110100010111101100011101011",
      "12345": "1101001110010110011100100010110001011110111011011100100111010110001100011101011",
      "MILK-1L-004": "110100100001011101100011000100010100011011101011000111010011011100100111001101000110111010011011100100111011001001110110011001001110101000111101100011101011"
  };

  it.each(Object.keys(SOMEBODY_ELSES))("%s is the pattern another encoder gives it", (value) => {
    expect(code128Modules(value)).toBe(SOMEBODY_ELSES[value]);
  });

  it("a manufacturer's thirteen digits fit the standard sticker", () => {
    // 47 mm of sticker between its edges. In Set B this code was 198 modules
    // and each bar 0.237 mm — under the 0.25 a supermarket scanner needs, on
    // EVERY ordinary product, on the default size.
    const modules = code128ModuleCount("8961230000011");

    expect(modules).toBe(143);
    expect(47 / modules).toBeGreaterThan(0.25);
  });

  it("digits go two to a symbol, and an odd one out is still said", () => {
    // 12 digits: start + 6 pairs + check + stop. 13: the same, plus the switch and the last digit.
    expect(code128Modules("896123000001").length).toBe(11 * 8 + 13);
    expect(code128Modules("8961230000011").length).toBe(11 * 10 + 13);
  });

  it("a code with letters in it is left in the set that has letters", () => {
    expect(code128Modules("MILK-1L-004").length).toBe(11 * (1 + 11 + 1) + 13);
  });

  it("a short number is not worth the change of set", () => {
    // Three digits in Set C would be start, a pair, the switch, a digit: no shorter.
    expect(code128Modules("417").length).toBe(11 * (1 + 3 + 1) + 13);
  });
});
