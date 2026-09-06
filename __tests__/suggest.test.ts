import { PROJECT_ROOT, fs, path } from "./support/node";
import {
  type Suggestion,
  suggestionsFrom,
} from "../src/modules/marketplace/components/SearchSuggestions";
import type { PublicShop, SearchResult } from "../src/modules/marketplace/services/marketplaceService";

/**
 * WHAT YOU MEANT, WHILE YOU ARE STILL TYPING.
 *
 * ── The complaint ────────────────────────────────────────────────────
 *
 * "achy alogo k sth hr tarhan ki auto suggeestonn on type to slect what
 * customer need" — the search screen answered in three headed blocks, which is
 * the right shape for results somebody has committed to reading and the wrong
 * one for the two seconds while they are still typing. Finding the one row they
 * wanted meant reading three headings first.
 *
 * The rules below are the ones that are easy to lose on the next change and
 * expensive when they go: six is a glance, one kind must not take all six, and
 * a row that leads nowhere must not pretend to lead somewhere.
 */

const shop = (slug: string, name = slug): PublicShop => ({
  slug,
  business_name: name,
  business_type: "food",
  business_category: null,
  city: { id: "c1", name: "Lahore" },
  logo_path: null,
  rating: 4.5,
  reviews_count: 3,
});

const product = (id: string, name: string, withShop = true): SearchResult["products"][number] => ({
  id,
  name,
  brand: null,
  price: 250,
  original_price: null,
  image: null,
  shop: withShop ? { slug: "kfc", business_name: "KFC", business_type: "food" } : null,
  distance_km: 1.2,
});

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  query: "burger",
  products: [],
  shops: [],
  categories: [],
  ...over,
});

const kinds = (out: Suggestion[]) => out.map((s) => s.kind);

describe("the six best matches", () => {
  it("has nothing to say before the first response", () => {
    expect(suggestionsFrom(undefined)).toEqual([]);
    expect(suggestionsFrom(result())).toEqual([]);
  });

  it("stops at six", () => {
    // Twelve rows is a list somebody has to read; six is a list they glance at.
    const out = suggestionsFrom(
      result({ products: Array.from({ length: 20 }, (_, i) => product(`p${i}`, `Burger ${i}`)) }),
    );
    expect(out).toHaveLength(6);
  });

  it("never lets one kind take every slot", () => {
    // THE RULE THIS FILE EXISTS FOR. "burger" matches twenty products and four
    // shops; concatenating would show six products and no shop at all, so the
    // shop somebody was actually looking for is off the bottom of a list that
    // only holds six.
    const out = suggestionsFrom(
      result({
        products: Array.from({ length: 20 }, (_, i) => product(`p${i}`, `Burger ${i}`)),
        shops: [shop("burger-lab", "Burger Lab")],
        categories: [{ name: "Burgers", shops_count: 9 }],
      }),
    );

    expect(kinds(out)).toContain("shop");
    expect(kinds(out)).toContain("category");
    expect(kinds(out).filter((k) => k === "product").length).toBeLessThan(6);
  });

  it("still leads with products, because that is what people type", () => {
    const out = suggestionsFrom(
      result({
        products: [product("p1", "Zinger Burger"), product("p2", "Beef Burger")],
        shops: [shop("burger-lab", "Burger Lab")],
      }),
    );
    expect(kinds(out).slice(0, 2)).toEqual(["product", "product"]);
  });

  it("keeps the server's order inside a kind", () => {
    // `/marketplace/search` scores an exact name match above a prefix above a
    // body match. Re-sorting here would be a second opinion formed with less
    // information than the server had.
    const out = suggestionsFrom(
      result({ products: [product("p1", "Burger"), product("p2", "Burger Bun")] }),
    );
    expect(out.map((s) => s.label)).toEqual(["Burger", "Burger Bun"]);
  });

  it("fills the six from whoever is left when a kind runs out", () => {
    // The denominator for the interleave: with only products in the response,
    // holding slots open for shops that do not exist would show four rows on a
    // screen with room for six.
    const out = suggestionsFrom(
      result({ products: Array.from({ length: 9 }, (_, i) => product(`p${i}`, `Burger ${i}`)) }),
    );
    expect(out).toHaveLength(6);
  });

  it("terminates on a response with empty arrays rather than spinning", () => {
    // The loop advances only while something moves. An `every queue empty`
    // response must leave it, not sit in it.
    expect(suggestionsFrom(result({ products: [], shops: [], categories: [] }))).toEqual([]);
  });
});

describe("a row knows where it goes", () => {
  it("sends a product to the shop that sells it", () => {
    const [row] = suggestionsFrom(result({ products: [product("p1", "Zinger")] }));
    expect(row.slug).toBe("kfc");
  });

  it("admits when a product has no shop to open", () => {
    // Search returns the shop for a product it can place. When it cannot, the
    // row must carry null rather than `undefined` sliding into a route param —
    // which navigates to a shop screen that loads nothing and blames the network.
    const [row] = suggestionsFrom(result({ products: [product("p1", "Zinger", false)] }));
    expect(row.slug).toBeNull();
  });

  it("gives a category no slug, because it is a filter and not a place", () => {
    const [row] = suggestionsFrom(result({ categories: [{ name: "Burgers", shops_count: 9 }] }));
    expect(row.slug).toBeNull();
    expect(row.kind).toBe("category");
  });

  it("says how many shops a category holds", () => {
    const one = suggestionsFrom(result({ categories: [{ name: "Bakery", shops_count: 1 }] }));
    const many = suggestionsFrom(result({ categories: [{ name: "Burgers", shops_count: 9 }] }));
    expect(one[0].detail).toBe("1 shop");
    expect(many[0].detail).toBe("9 shops");
  });
});

describe("the screens wire it up", () => {
  const read = (rel: string) =>
    fs
      .readFileSync(path.join(PROJECT_ROOT, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

  const search = read("src/modules/marketplace/screens/SearchScreen.tsx");
  const browse = read("src/modules/marketplace/screens/BrowseScreen.tsx");

  it("shows the suggestions on the mixed tab only", () => {
    // Products and Shops are somebody who has already said which KIND they
    // want. A mixed list is the wrong answer to that.
    expect(search).toMatch(/tab === "all" && \(\s*<SearchSuggestions/);
  });

  it("handles a category by narrowing the aisle rather than opening nothing", () => {
    expect(search).toMatch(/kind === "category"[\s\S]{0,200}navigate\("Browse"/);
  });

  it("refuses to navigate with a missing slug", () => {
    const fn = search.slice(search.indexOf("const openSuggestion"));
    const body = fn.slice(0, fn.indexOf("\n  };"));
    expect(body).toMatch(/slug == null/);
    // …and the guard comes BEFORE the navigate, or it is not a guard.
    expect(body.indexOf("slug == null")).toBeLessThan(body.indexOf('navigate("MarketShop"'));
  });

  it("gives the aisle a box to type in", () => {
    // "Search page py Search bar b add krdo" — arriving on the aisle from a
    // home shortcut, you could narrow by price, rating, category and stock,
    // and you could not say the one word you came for.
    expect(browse).toMatch(/<AppTextInput[\s\S]*?onChangeText=\{setTerm\}/);
  });

  it("debounces the box rather than querying every keystroke", () => {
    // Nine letters typed at speed is nine requests, and the 429 the app then
    // has to sit out belongs to the person who typed, not to the one who
    // caused it.
    expect(browse).toMatch(/useDebouncedValue\(term,/);
  });

  it("puts the typed term into the query the list actually runs", () => {
    // The box and the request are two different things; a box wired to nothing
    // is the failure mode this catches.
    expect(browse).toMatch(/const base: BrowseFilters = \{\s*q: q \|\| undefined,/);
    expect(browse).toMatch(/const query = \{ \.\.\.base, \.\.\.filters/);
  });

  it("starts a new search at the top of the list", () => {
    expect(browse).toMatch(/scrollToOffset\(\{ offset: 0[\s\S]*?\}, \[q\]\)/);
    expect(browse).toMatch(/ref=\{listRef\}/);
  });
});
