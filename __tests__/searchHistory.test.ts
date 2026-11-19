import { PROJECT_ROOT, fs, path } from "./support/node";
import { RECENT_MAX, popularTerms, withRecent, worthRemembering } from "../src/common/utils/searchHistory";
import { CITIES_SHOWN, citiesToShow } from "../src/modules/marketplace/components/ShopFilterSheet";

/**
 * "Recent search b ayen kuch" — the history filled with prefixes and typos,
 * and a search just made did not show until the screen was opened again.
 */
describe("recent searches", () => {
  it("puts the newest first and never the same word twice, in any case", () => {
    expect(withRecent(["milk", "Pizza"], "pizza")).toEqual(["pizza", "milk"]);
    expect(withRecent(["milk"], "  Panadol ")).toEqual(["Panadol", "milk"]);
  });

  it("keeps no more than the cap, dropping the oldest", () => {
    const full = Array.from({ length: RECENT_MAX }, (_, i) => `term ${i}`);
    const next = withRecent(full, "new one");
    expect(next).toHaveLength(RECENT_MAX);
    expect(next[0]).toBe("new one");
    expect(next).not.toContain(`term ${RECENT_MAX - 1}`);
  });

  it("ignores a term shorter than two letters, and blanks", () => {
    expect(withRecent(["milk"], "a")).toEqual(["milk"]);
    expect(withRecent(["milk"], "   ")).toEqual(["milk"]);
  });

  it("a cap of zero or less keeps nothing rather than throwing", () => {
    expect(withRecent(["milk"], "pizza", 0)).toEqual([]);
    expect(withRecent(["milk"], "pizza", -3)).toEqual([]);
  });

  it("remembers only what found something", () => {
    expect(worthRemembering("pizza", 3)).toBe(true);
    expect(worthRemembering("pizzq", 0)).toBe(false);
    expect(worthRemembering("pizza", undefined)).toBe(false);
    expect(worthRemembering("p", 9)).toBe(false);
    expect(worthRemembering("  ", 9)).toBe(false);
  });

  it("does not store with a different rule from the one on screen", () => {
    const prefs = fs.readFileSync(path.join(PROJECT_ROOT, "src/common/utils/prefs.ts"), "utf8");
    expect(prefs).toMatch(/withRecent\(current\.searches \?\? \[\], clean, RECENT_SEARCHES\)/);
    expect(prefs).toMatch(/const RECENT_SEARCHES = RECENT_MAX;/);
  });

  it("the search screen remembers on a settled, successful search and on Search pressed", () => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, "src/modules/marketplace/screens/SearchScreen.tsx"), "utf8");
    expect(src).toMatch(/useDebouncedValue\(q, 1200\)/);
    expect(src).toMatch(/if \(worthRemembering\(settled, found\)\) remember\(settled\)/);
    expect(src).toMatch(/onSubmitEditing=/);
    // The list on screen takes the new term at once.
    expect(src).toMatch(/setRecent\(\(list\) => withRecent\(list, term\)\)/);
    // The quarter-second rule that kept "piz" is gone.
    expect(src).not.toMatch(/prefs\.rememberSearch\(debounced\)/);
  });
});

describe("popular near you", () => {
  it("offers item names, cleaned, once each, never ones already in the history", () => {
    expect(popularTerms(["Margherita  Pizza", "Milk 1L", "milk 1l", "Panadol"], ["panadol"])).toEqual([
      "Margherita Pizza",
      "Milk 1L",
    ]);
  });

  it("skips names too short or too long for a chip, and nulls", () => {
    const long = "Extra Large Family Size Chicken Tikka Pizza Deal";
    expect(popularTerms([null, undefined, "", "A", long, "Eggs"], [])).toEqual(["Eggs"]);
  });

  it("stops at the cap", () => {
    expect(popularTerms(["a1", "b2", "c3", "d4"], [], 2)).toEqual(["a1", "b2"]);
    expect(popularTerms(["a1"], [], 0)).toEqual([]);
  });
});

describe("filter sheet cities", () => {
  const city = (n: number) => ({ id: `c${n}`, name: `City ${n}` });
  const many = Array.from({ length: CITIES_SHOWN + 4 }, (_, i) => city(i));

  it("shows a short list whole", () => {
    expect(citiesToShow(many.slice(0, 3), undefined, false)).toHaveLength(3);
  });

  it("trims a long list until Show all", () => {
    expect(citiesToShow(many, undefined, false)).toHaveLength(CITIES_SHOWN);
    expect(citiesToShow(many, undefined, true)).toHaveLength(many.length);
  });

  it("always shows the city picked, even past the cut", () => {
    const last = many[many.length - 1];
    const shown = citiesToShow(many, last.id, false);
    expect(shown).toContain(last);
    expect(shown).toHaveLength(CITIES_SHOWN + 1);
  });

  it("scrolls inside the sheet, so Show shops stays above the phone's buttons", () => {
    const src = fs.readFileSync(
      path.join(PROJECT_ROOT, "src/modules/marketplace/components/ShopFilterSheet.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<ScrollView style=\{styles\.scroll\}/);
    expect(src).toMatch(/scroll: \{ flexShrink: 1 \}/);
    expect(src).toMatch(/dragHandleOnly/);
  });

  it("does not show the picked city twice when it is already in view", () => {
    expect(citiesToShow(many, many[0].id, false)).toHaveLength(CITIES_SHOWN);
  });
});
