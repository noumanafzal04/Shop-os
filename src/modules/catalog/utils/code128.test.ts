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
