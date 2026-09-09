import React from "react";
import { ScrollView, View } from "react-native";
import ReactTestRenderer from "react-test-renderer";
import { ShopWithItems } from "../src/modules/marketplace/components/ShopWithItems";
import { ThemeProvider } from "../src/theme";
import type { PublicShop } from "../src/modules/marketplace/services/marketplaceService";

/**
 * A SHOP WITH ONE DISH ON IT.
 *
 * Reported as "jab kisi shop ki 1 ya 2 products hoti hain to achi nahi show ho
 * rahi". The item strip was a horizontal scroller of fixed 132pt tiles plus an
 * 88pt "See all" tile, so one item measured 232pt inside a ~358pt card: a
 * third of the card empty and the See-all tile floating in the middle of it.
 *
 * The card is MOUNTED here rather than grepped, because the bug was in the
 * arithmetic between three style rules and a container choice — the exact
 * thing a source scan reads straight past.
 */
const item = (id: string, name: string) => ({
  id,
  name,
  price: "450",
  original_price: null,
  image: null,
});

const shop = (count: number): PublicShop =>
  ({
    slug: "burger-hut",
    business_name: "Burger Hut",
    business_type: "food",
    rating: 4.5,
    reviews_count: 12,
    logo_path: null,
    city: "Lahore",
    is_open_now: true,
    preview_products: Array.from({ length: count }, (_, i) => item(`p${i}`, `Dish ${i + 1}`)),
  }) as unknown as PublicShop;

async function render(count: number) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <ShopWithItems shop={shop(count)} onOpen={jest.fn()} onItem={jest.fn()} />
      </ThemeProvider>,
    );
  });

  return tree;
}

/** Flattened style of the tile carrying an item's accessibility label. */
const tileStyle = (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const node = tree.root.findAll(
    (n) => typeof n.type !== "string" && n.props?.accessibilityLabel === label,
  )[0];

  return StyleFlat(node.props.style);
};

function StyleFlat(style: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (Array.isArray(s)) s.forEach(walk);
    else if (s && typeof s === "object") Object.assign(out, s);
  };
  walk(style);

  return out;
}

describe("a shop card with only one or two things on it", () => {
  it("shares the row instead of leaving a hole", async () => {
    const tree = await render(1);
    const style = tileStyle(tree, "Dish 1");

    expect(style.flex).toBe(1);
    // `width: undefined` is load-bearing — 132 would win the flex basis and
    // leave the same gap this exists to close.
    expect(style.width).toBeUndefined();

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("does not pretend there is something to scroll to", async () => {
    // A horizontal ScrollView holding 232pt of content in a 358pt card is a
    // gesture that does nothing, and a scroll indicator that never moves.
    const tree = await render(2);

    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
    expect(tree.root.findAllByType(View).length).toBeGreaterThan(0);

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("keeps the way in beside them", async () => {
    // The See-all tile is the point of the strip, not a filler for the end of
    // it — with one dish it takes the other half of the row.
    const tree = await render(1);
    const style = tileStyle(tree, "See everything at Burger Hut");

    expect(style.flex).toBe(1);

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("goes back to a scroller once there is more than fits", async () => {
    /**
     * Three × 132 plus the gaps plus See all is wider than any phone, so the
     * strip genuinely scrolls and the fixed tile width is right again. Without
     * this test the fix could have been "never scroll", which would have
     * squeezed a menu of forty into three 90pt slivers.
     */
    const tree = await render(3);

    expect(tree.root.findAllByType(ScrollView)).toHaveLength(1);
    expect(tileStyle(tree, "Dish 1").width).toBe(132);

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("still gives a shop with nothing listed a card", async () => {
    // A card that collapses because a shop has not uploaded photographs yet
    // would punish the newest shops hardest.
    const tree = await render(0);

    expect(tree.toJSON()).not.toBeNull();
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);

    await ReactTestRenderer.act(() => tree.unmount());
  });
});
