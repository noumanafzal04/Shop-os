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

/**
 * THE RATIO IS A CONTRACT, NOT A LAYOUT CHOICE.
 *
 * ── Why this is worth a test ─────────────────────────────────────────
 *
 * Two other places now depend on this number. The admin form asks for
 * 1200×600 and `BannerRequest::checkShape()` REFUSES anything that is not
 * 2:1 — because the card is filled with `cover`, which keeps the ratio and
 * lets the surplus hang off the edges.
 *
 * So moving `RATIO` here does not change the layout, it silently invalidates
 * every banner already uploaded and every one the form will accept
 * afterwards. Nothing anywhere fails; the adverts just start appearing cut,
 * which is how this was found: "banner cutting on mobile, not full banner
 * showing" — against artwork made at 1200×480, the size the form used to ask
 * for.
 *
 * The card is also 2:1 at EVERY screen width — width less 32 points, height
 * half of that — which is the other thing the form used to get wrong. It
 * blamed "narrow phones" for a crop the file causes.
 */
describe("the shape the artwork is commissioned at", () => {
  const src = fs.readFileSync(
    path.join(PROJECT_ROOT, "src/modules/marketplace/components/PromoCarousel.tsx"),
    "utf8",
  );

  it("is 2:1", () => {
    expect(src).toMatch(/^const RATIO = 2;/m);
  });

  it("is the same at every screen width", () => {
    // Height derived from the card's own width, not from a breakpoint. A
    // ratio that varied by device would make "keep text in the middle" the
    // only advice anybody could give.
    expect(src).toMatch(/const cardWidth = width - spacing\.md \* 2;/);
    expect(src).toMatch(/const cardHeight = Math\.round\(cardWidth \/ RATIO\);/);
  });

  it("fills the card, which is what makes the ratio matter", () => {
    // `SmartImage` defaults to `resizeMode="cover"`. If this ever became
    // `contain`, off-ratio artwork would letterbox instead of crop — the
    // upload rule would be refusing files it no longer needs to.
    const smart = fs.readFileSync(
      path.join(PROJECT_ROOT, "src/common/ui/SmartImage.tsx"),
      "utf8",
    );
    expect(smart).toMatch(/resizeMode = "cover"/);
    // And the carousel does not override it back.
    expect(src).not.toMatch(/<SmartImage[^>]*resizeMode=/);
  });
});
