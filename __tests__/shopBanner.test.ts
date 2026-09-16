import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";
import { shopAvatar, shopBanner, shopLogo } from "../src/modules/marketplace/shopCover";

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
