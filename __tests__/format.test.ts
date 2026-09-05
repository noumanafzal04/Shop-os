import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import { money, qtyText } from "../src/common/format";
import { shopCover, shopInitial } from "../src/modules/marketplace/shopCover";

/**
 * How money and quantities are written — and the eight copies of that rule
 * this file exists to stop coming back.
 */

describe("money", () => {
  it("writes a price a customer recognises", () => {
    expect(money(4828)).toBe("Rs 4,828");
  });

  it("reads a decimal STRING, which is what Laravel sends", () => {
    // Half the copies were typed `(n: number)`, so a total taken straight off
    // the wire came out as "Rs NaN" on those screens and correctly on the rest.
    expect(money("4828.00")).toBe("Rs 4,828");
  });

  it("says zero rather than nothing when there is no value", () => {
    expect(money(null)).toBe("Rs 0");
    expect(money(undefined)).toBe("Rs 0");
  });

  it("never prints NaN at somebody", () => {
    expect(money("not a number")).toBe("Rs 0");
  });
});

describe("quantities", () => {
  it("drops the database's trailing zeros", () => {
    // The order tracking screen printed `2.00×`, which then wrapped onto two
    // lines inside a 30px column.
    expect(qtyText("2.000")).toBe("2");
    expect(qtyText(2)).toBe("2");
  });

  it("keeps a weight that somebody actually chose", () => {
    expect(qtyText(0.25)).toBe("0.25");
    expect(qtyText("1.500")).toBe("1.5");
  });
});

describe("nobody writes these rules out again", () => {
  it("has no screen defining its own money or quantity formatter", () => {
    const files = sourceFiles(path.join(PROJECT_ROOT, "src")).filter(
      (f) => !f.endsWith("format.ts"),
    );
    expect(files.length).toBeGreaterThan(30);

    const copies = files
      .flatMap((f) =>
        fs
          .readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /^const (money|fmtQty|qtyText) = /.test(line))
          .map(([n, line]) => `  ${path.relative(PROJECT_ROOT, f)}:${n}  ${line.trim()}`),
      );

    // There were EIGHT of `money` and three of `fmtQty`, and they had already
    // drifted in what they accepted.
    expect(copies.join("\n")).toBe("");
  });
});

describe("a shop's cover, before it has a photograph", () => {
  it("gives one shop the same colour every time", () => {
    expect(shopCover("burger-hut")).toEqual(shopCover("burger-hut"));
  });

  it("tells apart two shops whose slugs nearly match", () => {
    // Summing character codes — the obvious hash — gives these the same
    // colour, and the demo data is full of exactly this shape.
    expect(shopCover("sweep-mart")).not.toEqual(shopCover("sweep-food"));
  });

  it("still has a colour for a shop with no slug", () => {
    expect(shopCover(null).bg).toMatch(/^#/);
    expect(shopCover(undefined).fg).toMatch(/^#/);
  });

  it("never draws the letter in the colour behind it", () => {
    for (const slug of ["a", "b", "c", "burger-hut", "sweep-mart", "karahi-house"]) {
      const { bg, fg } = shopCover(slug);
      expect(fg).not.toBe(bg);
    }
  });

  it("always has a letter to draw", () => {
    expect(shopInitial("Karahi House")).toBe("K");
    expect(shopInitial("  sweep mart")).toBe("S");
    expect(shopInitial("")).toBe("?");
    expect(shopInitial(null)).toBe("?");
  });
});
