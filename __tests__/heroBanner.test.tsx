import React from "react";
import { Animated, Text } from "react-native";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { HomeHero } from "../src/modules/marketplace/components/HomeHero";
import { ThemeProvider } from "../src/theme";
import type { HeroBanner } from "../src/modules/marketplace/services/marketplaceService";

/**
 * THE TOP OF HOME WEARS THE ADMIN'S BANNER — its colour, words, button and
 * link — and falls back to the app's own slides only when none is live.
 */

const own = [{ id: "own-1", title: "The shops on your street", body: "Near you", cta: "Browse", emoji: "x", onPress: jest.fn() }];

const hero = (over: Partial<HeroBanner> = {}): HeroBanner => ({
  id: "h1",
  title: "Eid deals are here",
  body: "Up to half off near you",
  cta: "Order now",
  color: "#7a1f5c",
  style: "words",
  image_url: null,
  image_size: 120,
  target: { type: "url", url: "https://example.com" },
  ...over,
});

async function render(heroes: HeroBanner[], onBanner = jest.fn()) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider>
        <ThemeProvider>
          <HomeHero header={null} hero={heroes} onBanner={onBanner} ownSlides={own} autoPlay={false} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

const words = (t: ReactTestRenderer.ReactTestRenderer) =>
  t.root.findAllByType(Text).map((n) => n.props.children).filter((x) => typeof x === "string");

const blockColour = (t: ReactTestRenderer.ReactTestRenderer) => {
  const flat = (st: unknown): Record<string, unknown> =>
    Array.isArray(st) ? Object.assign({}, ...st.map(flat)) : ((st as Record<string, unknown>) ?? {});
  return flat(t.root.findAllByType(Animated.View)[0].props.style).backgroundColor;
};

describe("the top header", () => {
  it("shows the admin's banner — title, line and button — in place of the app's slides", async () => {
    const t = await render([hero()]);
    expect(words(t)).toEqual(expect.arrayContaining(["Eid deals are here", "Up to half off near you", "Order now"]));
    expect(words(t)).not.toContain("The shops on your street");
    await ReactTestRenderer.act(() => t.unmount());
  });

  it("takes the colour the admin chose", async () => {
    const t = await render([hero()]);
    expect(blockColour(t)).toBe("#7a1f5c");
    await ReactTestRenderer.act(() => t.unmount());
  });

  it("opens the banner's link on a tap", async () => {
    const onBanner = jest.fn();
    const t = await render([hero()], onBanner);
    const slide = t.root.findAll((n) => typeof n.props.onPress === "function" && String(n.props.accessibilityLabel ?? "").startsWith("Eid deals"))[0];
    await ReactTestRenderer.act(() => slide!.props.onPress());
    expect(onBanner).toHaveBeenCalledWith(expect.objectContaining({ id: "h1" }));
    await ReactTestRenderer.act(() => t.unmount());
  });

  it("leaves out a button the admin did not write", async () => {
    const t = await render([hero({ cta: null, body: null })]);
    expect(words(t)).toEqual(["Eid deals are here"]);
    await ReactTestRenderer.act(() => t.unmount());
  });

  it("speaks for the app when no top banner is live", async () => {
    const t = await render([]);
    expect(words(t)).toContain("The shops on your street");
    await ReactTestRenderer.act(() => t.unmount());
  });
});
