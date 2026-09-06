import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { ThemeProvider } from "../src/theme";
import { OfferBadge, Price } from "../src/common/ui/Price";

/**
 * THE PRICE, AS IT ACTUALLY DRAWS.
 *
 * `price.test.ts` proves the arithmetic. This proves the RENDER, and it exists
 * because a mutation run said it had to: replacing the component's
 * `hasCut(value, was)` with the very check every screen used to make —
 * `was != null` — put the app's whole discount bug back and the pure-function
 * tests all stayed green. A rule enforced in one file and read in another is
 * two chances to be wrong; this closes the second.
 */

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

/**
 * Every line of text the tree puts on screen.
 *
 * The children of one `<Text>` are JOINED rather than listed: `{pct}% OFF`
 * arrives as `[20, "% OFF"]`, and reading only the strings out of that reports
 * "% OFF" — a badge with no number in it, which is exactly the failure this
 * file would then be blind to.
 */
const words = (tree: ReactTestRenderer.ReactTestRenderer): string[] =>
  tree.root
    .findAllByType("Text" as never)
    .map((n) => {
      const kids = Array.isArray(n.props.children) ? n.props.children : [n.props.children];
      return kids
        .filter((k: unknown) => typeof k === "string" || typeof k === "number")
        .join("");
    })
    .filter((s) => s.length > 0);

describe("what a price puts on the screen", () => {
  it("draws the price on its own when nothing is on offer", async () => {
    const tree = await render(<Price value={300} />);
    expect(words(tree)).toEqual(["Rs 300"]);
  });

  it("draws the pair when there is a genuine cut", async () => {
    const tree = await render(<Price value={250} was={300} />);
    expect(words(tree)).toEqual(["Rs 250", "Rs 300"]);
  });

  it("REFUSES to draw a strike-through against the same number", async () => {
    // The bug, at the only layer that can still commit it. A shop that fills in
    // a regular price without running a sale must not have the app advertise a
    // discount in its name.
    const tree = await render(<Price value={300} was={300} />);
    expect(words(tree)).toEqual(["Rs 300"]);
  });

  it("refuses when the 'regular' price is lower", async () => {
    const tree = await render(<Price value={350} was={300} />);
    expect(words(tree)).toEqual(["Rs 350"]);
  });

  it("reads the decimal strings the server sends", async () => {
    const tree = await render(<Price value="250.00" was="300.00" />);
    expect(words(tree)).toEqual(["Rs 250", "Rs 300"]);
  });

  it("strikes only the old price through, never the new one", async () => {
    const tree = await render(<Price value={250} was={300} />);
    const texts = tree.root.findAllByType("Text" as never);
    const struck = texts.filter((t) => {
      const flat = [t.props.style].flat(3).filter(Boolean);
      return flat.some((s: any) => s?.textDecorationLine === "line-through");
    });
    expect(struck).toHaveLength(1);
    expect(struck[0].props.children).toBe("Rs 300");
  });
});

describe("what a badge puts on the screen", () => {
  it("says the cut", async () => {
    const tree = await render(<OfferBadge value={250} was={300} />);
    expect(words(tree)).toEqual(["17% OFF"]);
  });

  it("draws NOTHING when there is no cut, so a caller need not ask first", async () => {
    for (const props of [{ value: 300 }, { value: 300, was: 300 }, { value: 350, was: 300 }]) {
      const tree = await render(<OfferBadge {...props} />);
      expect(words(tree)).toEqual([]);
    }
  });

  it("prefers the server's own percentage where there is one", async () => {
    // The deals rail is scored and ordered by `percent_off`; recomputing it
    // from two rounded rupee figures can disagree with the ordering of the
    // list the badge is sitting in.
    const tree = await render(<OfferBadge value={250} was={300} percent={20} />);
    expect(words(tree)).toEqual(["20% OFF"]);
  });

  it("is amber, not the colour of the buttons around it", async () => {
    // The palette is explicit: warm is "offers, ratings, the selected tab —
    // never a button". Three of these badges were `brand[500]`, which is the
    // fill on every real button in the app.
    const tree = await render(<OfferBadge value={250} was={300} />);
    const view = tree.root.findAllByType("View" as never)[0];
    const flat = [view.props.style].flat(3).filter(Boolean);
    const bg = flat.map((s: any) => s?.backgroundColor).find(Boolean);

    expect(bg).toBe("#ebc249");
  });
});
