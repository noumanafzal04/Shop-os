import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";
import { shopAvatar, shopBanner, shopHero, shopLogo } from "../src/modules/marketplace/shopCover";

/**
 * "HOME PY SHOP KI COVER IMAGE SHOW NI HO RHI" — and it never had.
 *
 * The home rail's card is 264 wide with a 120pt band across the top: the slot
 * every marketplace puts a photograph in. What it drew there was
 * `shopLogo(shop)`. `cover_url` had been in the payload since the cover
 * feature shipped and exactly one screen read it — the shop page.
 *
 * So the app was reaching for the wrong field in the right shape, and a shop
 * that had uploaded a cover and no logo showed a letter. Two failures, one
 * cause, and neither of them visible from the backend where the field was
 * present and correct.
 *
 * Two rules, and they are opposites on purpose:
 *   a BAND  wants the cover, and falls back to the logo
 *   a SQUARE wants the logo,  and falls back to the cover
 */
const read = (rel: string) => fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8");

const withBoth = { cover_url: "https://x/c.png", logo_url: "https://x/l.png" };
const coverOnly = { cover_url: "https://x/c.png", logo_url: null };
const logoOnly = { cover_url: null, logo_url: "https://x/l.png" };
const neither = { cover_url: null, logo_url: null, logo_path: null };

describe("which picture a slot asks for", () => {
  it("gives a band the cover when there is one", () => {
    expect(shopBanner(withBoth)).toEqual({ uri: "https://x/c.png", kind: "cover" });
    expect(shopBanner(coverOnly)).toEqual({ uri: "https://x/c.png", kind: "cover" });
  });

  it("falls back to the logo rather than to a letter", () => {
    expect(shopBanner(logoOnly)).toEqual({ uri: "https://x/l.png", kind: "logo" });
  });

  it("says which one it gave back, so a logo can be fitted instead of cropped", () => {
    // The reason the kind exists: `SmartImage` crops to fill, which is right
    // for a photograph and takes a slice out of the middle of a square mark.
    expect(shopBanner(logoOnly).kind).toBe("logo");
    expect(shopBanner(coverOnly).kind).toBe("cover");
  });

  it("asks the other way round for a square", () => {
    expect(shopAvatar(withBoth)).toBe("https://x/l.png");
    expect(shopAvatar(coverOnly)).toBe("https://x/c.png");
  });

  it("answers nothing when a shop has uploaded nothing, so the letter is drawn at once", () => {
    expect(shopBanner(neither)).toEqual({ uri: null, kind: null });
    expect(shopAvatar(neither)).toBeNull();
  });

  it("still refuses a bare storage path, which is what shopLogo is for", () => {
    // A relative path makes SmartImage wait for an image that can never
    // arrive, so the letter shimmers first instead of being drawn.
    expect(shopLogo({ logo_path: "logos/abc.png" })).toBeNull();
    expect(shopBanner({ cover_url: null, logo_path: "logos/abc.png" }).uri).toBeNull();
  });
});

describe("the screens actually use them", () => {
  /**
   * Sliced from the CARD, not from the file.
   *
   * A whole-file grep for `shopAvatar` passes while the band still draws a
   * logo, because the same file has a square slot that legitimately wants
   * one. The anchor is the band's own style — and it is taken from
   * `lastIndexOf` of the JSX, not the style sheet, because `railCover` is
   * written again three hundred lines lower where the styles live.
   */
  const home = codeOnly(read("src/modules/marketplace/screens/CustomerHomeScreen.tsx"));
  const band = home.slice(home.indexOf("styles.railCover,"), home.indexOf("styles.railBody"));

  it("draws the cover in the band", () => {
    expect(band).not.toBe("");
    expect(band).toMatch(/uri=\{banner\.uri\}/);
    expect(band).not.toMatch(/shopLogo/);
  });

  it("fits a logo rather than cropping it", () => {
    expect(band).toMatch(/resizeMode=\{banner\.kind === "logo" \? "contain" : "cover"\}/);
  });

  it("uses the square rule for the row's avatar", () => {
    const row = home.slice(home.indexOf("styles.wideLogo}"), home.indexOf("styles.shopInfo"));
    expect(row).not.toBe("");
    expect(row).toMatch(/uri=\{shopAvatar\(shop\)\}/);
  });

  it("leaves no screen still reaching for the logo in a wide slot", () => {
    // The two components that draw a shop beside its goods. Both are square.
    for (const rel of [
      "src/modules/marketplace/components/ShopWithItems.tsx",
      "src/modules/marketplace/components/SearchSuggestions.tsx",
    ]) {
      expect(codeOnly(read(rel))).not.toMatch(/\bshopLogo\(/);
    }
  });
});

/**
 * "LOGO HI COVER BAN JATA HAI" — the shop page's 200-point hero took the logo
 * when there was no cover, so a small mark was stretched and cropped into a
 * band with the same logo again beside the name. The hero is a PHOTOGRAPH or
 * nothing; a logo never fills it.
 */
describe("shopHero — the shop page hero is a photograph or nothing", () => {
  it("takes the cover first", () => {
    expect(shopHero({ cover_url: "c.jpg", gallery: ["g.jpg"] })).toBe("c.jpg");
  });

  it("falls back to the gallery's first real photograph", () => {
    expect(shopHero({ cover_url: null, gallery: [null, "", "g2.jpg"] })).toBe("g2.jpg");
  });

  it("never uses the logo — a shop with only a logo gets the plain header", () => {
    expect(shopHero({ cover_url: null, gallery: [], logo_url: "logo.png", logo_path: "logo.png" } as never)).toBeNull();
    expect(shopHero({ cover_url: "", gallery: null })).toBeNull();
  });

  it("answers null while the shop is still loading", () => {
    expect(shopHero(undefined)).toBeNull();
    expect(shopHero(null)).toBeNull();
  });

  it("the shop page reads its hero from shopHero, not from the logo", () => {
    const src = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/modules/marketplace/screens/MarketShopScreen.tsx"), "utf8"),
    );
    expect(src).toMatch(/const hero = shopHero\(shop\.data\)/);
    expect(src).not.toMatch(/\bshopLogo\(/);
  });
});

/**
 * THE HOME CARD'S BIG PICTURE — "hmare card b achy thy, thora sa mix krdo,
 * food items b show hon". Our card (logo, facts, the strip of dishes) gains
 * foodpanda's photo across the top: the shop's cover, or its first pictured
 * dish; nothing at all rather than a stretched logo.
 */
describe("cardPicture — the photo across the top of a home card", () => {
  const { cardPicture } = jest.requireActual("../src/modules/marketplace/shopCover");

  it("takes the cover first", () => {
    expect(cardPicture({ cover_url: "c.jpg", preview_products: [{ image: "d.jpg" }] })).toBe("c.jpg");
  });

  it("else the first dish that has a photograph", () => {
    expect(cardPicture({ cover_url: null, preview_products: [{ image: null }, { image: "karahi.jpg" }] })).toBe("karahi.jpg");
  });

  it("else nothing — never the logo", () => {
    expect(cardPicture({ cover_url: null, preview_products: [{ image: null }], logo_url: "l.png" } as never)).toBeNull();
    expect(cardPicture({})).toBeNull();
  });

  it("the home card draws it", () => {
    const card = codeOnly(read("src/modules/marketplace/components/ShopWithItems.tsx"));
    expect(card).toMatch(/const picture = cardPicture\(shop\)/);
    expect(card).toMatch(/<SmartImage uri=\{picture\}/);
  });
});
