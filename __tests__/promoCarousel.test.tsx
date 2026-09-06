import React from "react";
import { Text } from "react-native";
import ReactTestRenderer from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PromoCarousel } from "../src/modules/marketplace/components/PromoCarousel";
import { ThemeProvider } from "../src/theme";
import { PROJECT_ROOT, fs, path } from "./support/node";
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

/**
 * A TITLE THAT WAS SAVED AND SHOWN NOWHERE.
 *
 * The banner's title was drawn only when the image FAILED. So an admin who
 * typed one on an image banner saw it nowhere: the field existed, saved, and
 * changed nothing anybody could see — which is the worst kind of control,
 * because it looks like it worked.
 *
 * Found while building the admin preview, by asking what the preview would
 * honestly have to show.
 */
describe("a banner's headline", () => {
  const src = fs
    .readFileSync(
      path.join(PROJECT_ROOT, "src/modules/marketplace/components/PromoCarousel.tsx"),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("is drawn over the picture, not only when there is none", () => {
    // The scrim sits inside the branch that HAS an image_url.
    const withImage = src.slice(src.indexOf('if ("image_url" in item)'), src.indexOf("const { bg, fg }"));
    expect(withImage).toMatch(/\{!!item\.title && \(/);
    expect(withImage).toMatch(/styles\.scrim/);
  });

  it("gives the words a ground, because white on a photograph is a coin toss", () => {
    expect(src).toMatch(/scrim: \{[\s\S]*?backgroundColor: "rgba\(12,7,5,0\.62\)"/);
    // A BAND, not a full overlay: the picture is what the advertiser paid for.
    expect(src).toMatch(/scrim: \{[\s\S]*?bottom: 0,/);
    expect(src).not.toMatch(/scrim: \{[\s\S]*?top: 0,/);
  });

  it("draws nothing when there is no title", () => {
    // Most banners carry the words inside the artwork. A permanent dark band
    // across every one of them would be the app editing the advert.
    expect(src).toMatch(/\{!!item\.title &&/);
  });

  it("still has an answer for artwork that never arrives", () => {
    // The denominator: the fallback the title used to be the ONLY user of has
    // to survive being no longer the only user.
    expect(src).toMatch(/styles\.fallback/);
  });
});
