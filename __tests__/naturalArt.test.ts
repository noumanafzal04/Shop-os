import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";
import { categoryPhoto, photo, shortcutPicture, SLIDE_PHOTO } from "../src/modules/marketplace/tradePicture";

/**
 * "PEHLE WALY EMOJI ACHY NI LG RAHY, SPECIALLY ON BANNERS." Category tiles,
 * hero slides, the sign-in bubbles and the splash wear CC0 photographs; the
 * home shortcuts wear CC0 3D icons. Every file is licensed and listed.
 */
const read = (rel: string) => fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8");
const src = (rel: string) => codeOnly(read(rel));

describe("photographs for the kinds of shop", () => {
  it("finds one by the category's own code, then words in its name, then the trade", () => {
    expect(categoryPhoto("fast_food", "Fast Food", "food")).toBe(photo("burger"));
    expect(categoryPhoto("x", "Pizza Point", "food")).toBe(photo("pizza"));
    expect(categoryPhoto("x", "Lahori Karahi", "food")).toBe(photo("restaurant"));
    expect(categoryPhoto("grocery", "Mart & Grocery", "mart")).toBe(photo("mart"));
    expect(categoryPhoto("medical_store", "Pharmacy & Medical", "pharmacy")).toBe(photo("pharmacy"));
    expect(categoryPhoto("garments", "Garments & Clothing", "retail")).toBe(photo("clothing"));
    expect(categoryPhoto(null, null, "bakery")).toBe(photo("bakery"));
  });

  it("gives NO photograph where none fits — a wrong photo is worse than a good icon", () => {
    expect(categoryPhoto("tyre_shop", "Tyre Shop", "automotive")).toBeNull();
    expect(categoryPhoto("printing", "Printing", "services")).toBeNull();
  });

  it("the shortcuts are 3D icons, not emoji, and none draws a currency sign", () => {
    for (const k of ["offers", "cheap", "new", "top"]) expect(shortcutPicture(k)).toBeTruthy();
    expect(shortcutPicture("nope")).toBeNull();
    const tp = src("src/modules/marketplace/tradePicture.ts");
    expect(tp).toMatch(/offers: require\("\.\.\/\.\.\/assets\/art3d\/gift\.png"\)/);
    expect(tp).not.toMatch(/art3d\/(rupee|dollar|3d-coin)/);
  });

  it("every photograph and 3D icon is in the folder's LICENSE, and is CC0", () => {
    const photos = fs
      .readdirSync(path.join(PROJECT_ROOT, "src/assets/photos"), { withFileTypes: true })
      .map((e) => e.name)
      .filter((f) => f.startsWith("cat-"));
    const lic = read("src/assets/photos/LICENSE.md");
    for (const f of photos) expect(lic).toContain(f);
    expect(lic).not.toMatch(/\| (CC-BY|BY-SA|BY-NC)/i);
    expect(read("src/assets/art3d/LICENSE.md")).toMatch(/CC0/);
  });

  it("the tiles, slides, sign-in and splash use them", () => {
    expect(src("src/modules/marketplace/screens/CustomerHomeScreen.tsx")).toMatch(
      /categoryPhoto\(t\.value, t\.label, t\.trade\)/,
    );
    expect(src("src/modules/marketplace/screens/MarketScreen.tsx")).toMatch(
      /categoryPhoto\(t\.value, t\.label, t\.trade\)/,
    );
    expect(src("src/modules/marketplace/screens/MarketScreen.tsx")).toMatch(/photo: SLIDE_PHOTO\.vegetables/);
    expect(src("src/modules/marketplace/screens/CustomerHomeScreen.tsx")).toMatch(/photo: SLIDE_PHOTO\.restaurant/);
    expect(src("src/modules/marketplace/components/HomeHero.tsx")).toMatch(/item\.photo \? \(/);
    expect(src("src/modules/auth/components/AuthScreen.tsx")).toMatch(/art=\{photo\("burger"\)\}/);
    expect(src("src/common/ui/Splash.tsx")).toMatch(/assets\/photos\/cat-pizza\.jpg/);
    expect(Object.keys(SLIDE_PHOTO).length).toBeGreaterThanOrEqual(3);
  });
});

describe("empty screens wear a 3D picture (core EmptyState)", () => {
  const core = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, "..", "core", "src", rel), "utf8"));

  it("draws the picture for a warm empty state and keeps the icon for a muted one", () => {
    const es = core("ui/EmptyState.tsx");
    expect(es).toMatch(/picture && tone !== "muted" \? \(/);
    expect(es).toMatch(/source=\{ART3D\[picture\]\}/);
  });

  it("keeps the disc's corner under half its size (Fabric squares an exact half)", () => {
    expect(core("ui/EmptyState.tsx")).toMatch(/width: 84,\s*height: 84,\s*borderRadius: 40/);
  });

  it("the first screens a new account opens use it, in both apps", () => {
    for (const rel of [
      "src/modules/orders/screens/OrdersScreen.tsx",
      "src/modules/marketplace/screens/FavoritesScreen.tsx",
      "src/modules/account/screens/AddressesScreen.tsx",
      "src/modules/orders/screens/CartScreen.tsx",
    ]) {
      expect(src(rel)).toMatch(/picture="(bag|heart|pin|chat)"/);
    }
    const partner = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "..", "partner", "src/modules/orders/screens/OrdersScreen.tsx"), "utf8"),
    );
    expect(partner).toMatch(/picture="bag"/);
  });

  it("the 3D pictures are CC0 and listed", () => {
    const lic = fs.readFileSync(path.join(PROJECT_ROOT, "..", "core", "src", "assets", "art3d", "LICENSE.md"), "utf8");
    for (const f of ["bag.png", "heart.png", "map_pin.png", "chat_bubble.png", "wallet.png", "money_bag.png"]) {
      expect(lic).toContain(f);
    }
    expect(lic).toMatch(/CC0/);
  });
});
