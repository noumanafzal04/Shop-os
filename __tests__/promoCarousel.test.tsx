import React from "react";
import { Text } from "react-native";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PromoCarousel } from "../src/modules/marketplace/components/PromoCarousel";
import { ThemeProvider } from "../src/theme";
import type { HomeBanner } from "../src/modules/marketplace/services/marketplaceService";

/**
 * The promo strip at the top of the home screen, and the two things about it
 * that are decisions rather than layout.
 */

async function render(banners: HomeBanner[], onPress = jest.fn()) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider>
        <ThemeProvider>
          <PromoCarousel banners={banners} onPress={onPress} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

const textOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((n) => n.props.children)
    .filter((x) => typeof x === "string")
    .join(" | ");

const banner = (over: Partial<HomeBanner> = {}): HomeBanner =>
  ({
    id: "b1",
    title: "Real advert",
    image_url: "https://example.test/b1.jpg",
    target: { type: "shop", shop_slug: "burger-hut" },
    ...over,
  }) as HomeBanner;

describe("when nobody has bought a banner", () => {
  it("still fills the strip", async () => {
    const tree = await render([]);

    // An empty band at the top of a home screen reads as a failed image load,
    // and a layout that changes shape depending on whether anyone bought an
    // advert is one nobody can design against.
    expect(textOf(tree)).toContain("Cash on delivery");

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("advertises only the app, never a shop or an offer", async () => {
    const tree = await render([]);
    const copy = textOf(tree);

    // A fabricated "50% off at ..." is an advertisement for something that does
    // not exist, and the person reading it cannot tell it from a real one.
    expect(copy).not.toMatch(/%|\boff\b|\bRs\b|\bdiscount\b|\bfree\b/i);

    await ReactTestRenderer.act(() => tree.unmount());
  });
});

describe("when there are real banners", () => {
  it("shows them instead of the placeholders", async () => {
    const tree = await render([banner()]);
    const copy = textOf(tree);

    expect(copy).not.toContain("Cash on delivery");

    await ReactTestRenderer.act(() => tree.unmount());
  });

  it("still shows a banner whose artwork did not load", async () => {
    const tree = await render([banner({ image_url: null, title: "Eid offers" })]);

    // The card keeps its SIZE and its tap. A hole in the row every time a CDN
    // is slow reflows the whole home screen.
    expect(textOf(tree)).toContain("Eid offers");

    await ReactTestRenderer.act(() => tree.unmount());
  });
});
