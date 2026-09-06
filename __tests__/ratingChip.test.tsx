import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { ThemeProvider } from "../src/theme";
import { RatingChip } from "../src/modules/marketplace/components/RatingChip";

/**
 * HOW GOOD A SHOP IS, IN ONE PLACE.
 *
 * The rating was drawn TWICE on the home card — first in `shopFacts()`, which
 * put it third in a grey run-on line, and again as a chip beside the name.
 * "rating 2 bar q show ho rhi cards py?" It is a chip now and nothing else,
 * because a chip pinned right lines up down a whole list and a number buried
 * between a prep time and a delivery fee cannot be compared with anything.
 */

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

const words = (tree: ReactTestRenderer.ReactTestRenderer): string[] =>
  tree.root
    .findAllByType("Text" as never)
    .map((n) => {
      const kids = Array.isArray(n.props.children) ? n.props.children : [n.props.children];
      return kids.filter((k: unknown) => typeof k === "string" || typeof k === "number").join("");
    })
    .filter((s) => s.length > 0);

describe("the rating chip", () => {
  it("says the rating to one decimal", async () => {
    expect(words(await render(<RatingChip rating={4.5} />))).toEqual(["4.5"]);
    // A whole number still gets its decimal, so a column of them lines up.
    expect(words(await render(<RatingChip rating={4} />))).toEqual(["4.0"]);
  });

  it("DRAWS NOTHING for a shop nobody has reviewed", async () => {
    // Not "0.0", not an empty star, not a dash. A new shop is not a bad shop,
    // and the one thing this app must not do is make a shop that opened last
    // week look like one people have judged and rejected.
    //
    // It is also the only thing standing between `rating.toFixed(1)` and a
    // null — which is a crash, not a blank.
    expect(words(await render(<RatingChip rating={null} />))).toEqual([]);
    expect(words(await render(<RatingChip rating={undefined} />))).toEqual([]);
  });

  it("has a plate for a photograph and a tint for a card", async () => {
    // A white chip on a card is a hole; an amber tint over a cover photo is
    // whatever the photo happens to be behind it.
    const bg = (tree: ReactTestRenderer.ReactTestRenderer) => {
      const view = tree.root.findAllByType("View" as never)[0];
      // The LAST one wins, the way React Native flattens a style array. The
      // first version of this read the first and reported the base chip's
      // colour for both variants — a helper that could not see the override
      // it was written to check.
      const flat = [view.props.style].flat(3).filter(Boolean);
      return flat.map((s: any) => s?.backgroundColor).filter(Boolean).pop();
    };

    expect(bg(await render(<RatingChip rating={4.5} />))).not.toBe(
      bg(await render(<RatingChip rating={4.5} variant="plate" />)),
    );
  });
});
