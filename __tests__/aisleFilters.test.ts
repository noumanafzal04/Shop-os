import { PROJECT_ROOT, fs, path } from "./support/node";
import { activeFilterCount } from "../src/modules/marketplace/components/FilterSheet";

/**
 * NARROWING BY WHAT A THING IS, AND BY WHETHER YOU CAN BUY IT.
 *
 * Every filter the aisle had answered the first question — category, size,
 * price, rating, on sale. None of them answered the second, which is the one
 * somebody hungry at nine in the evening is actually asking: which of these
 * can I buy RIGHT NOW, and which will not charge me to bring it.
 */

const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

describe("the two shop filters", () => {
  it("counts towards the badge, like every other filter", () => {
    // A filter that narrows the list and does not show in the count is a list
    // somebody cannot explain to themselves.
    expect(activeFilterCount({ open_now: true })).toBe(1);
    expect(activeFilterCount({ free_delivery: true })).toBe(1);
    expect(activeFilterCount({ open_now: true, free_delivery: true, on_sale: true })).toBe(3);
    expect(activeFilterCount({})).toBe(0);
  });

  it("is sent to the server, not applied on the page that happens to be loaded", () => {
    // The aisle pages. Filtering the loaded page would say "3 items" over a
    // catalogue of two hundred and be wrong on every scroll.
    const svc = read("src/modules/marketplace/services/marketplaceService.ts");
    expect(svc).toMatch(/if \(f\.open_now\) out\.open_now = 1;/);
    expect(svc).toMatch(/if \(f\.free_delivery\) out\.free_delivery = 1;/);
  });

  it("is one tap on the bar and a row in the sheet", () => {
    const bar = read("src/modules/marketplace/components/QuickFilters.tsx");
    expect(bar).toMatch(/label="Open now"/);
    expect(bar).toMatch(/label="Free delivery"/);

    const sheet = read("src/modules/marketplace/components/FilterSheet.tsx");
    expect(sheet).toMatch(/label="Open now"/);
    expect(sheet).toMatch(/label="Free delivery"/);
  });

  it("shows the server's own count beside each, when there is one", () => {
    // A facet counts what pressing it WOULD give, from here — the number is
    // the reason to press it rather than decoration.
    const sheet = read("src/modules/marketplace/components/FilterSheet.tsx");
    expect(sheet).toMatch(/f\.open_now_count/);
    expect(sheet).toMatch(/f\.free_delivery_count/);
  });
});

describe("the search box and the filter button share a row", () => {
  const browse = read("src/modules/marketplace/screens/BrowseScreen.tsx");

  it("puts the button on the search row", () => {
    // "make in front of filter button, search k right side." They were on two
    // rows, which put the app's two ways of narrowing a list in different
    // places and spent a whole row on each.
    const head = browse.slice(browse.indexOf("<View style={styles.head}>"), browse.indexOf("styles.sub"));
    expect(head).toMatch(/<AppTextInput/);
    // `\b`, because `styles.filterBtnOn` CONTAINS `styles.filterBtn` — the
    // loose version passed while the button had been swapped for the back
    // arrow's style and only the `On` variant was left carrying the name.
    expect(head).toMatch(/styles\.filterBtn\b/);
  });

  it("keeps the badge, so how many are on is answerable without opening it", () => {
    expect(browse).toMatch(/\{active > 0 && \(/);
    expect(browse).toMatch(/styles\.filterCount/);
  });

  it("does not draw the same control twice", () => {
    // The pill bar had its own Filters pill. Two copies of one control on one
    // screen is the screen disagreeing with itself about where things are.
    const bar = read("src/modules/marketplace/components/QuickFilters.tsx");
    expect(bar).not.toMatch(/onOpenAll/);
    expect(bar).not.toMatch(/label="Filters"|>Filters</);
    expect(browse).toMatch(/<QuickFilters filters=\{filters\} onChange=\{setFilters\} \/>/);
  });
});

describe("finding a category among sixty", () => {
  const sheet = read("src/modules/marketplace/components/FilterSheet.tsx");

  it("offers a search box once the list is long enough to need one", () => {
    // A grocery aisle carries dozens, and the only way through was "+48 more"
    // and a wall of chips — which is not a filter, it is the problem the
    // filter was meant to solve.
    expect(sheet).toMatch(/cats\.length > COLLAPSED && \(/);
    expect(sheet).toMatch(/placeholder=\{`Search \$\{cats\.length\} categories`\}/);
  });

  it("does not offer one for ten", () => {
    // On the shops that have ten, a search box for ten things is one more
    // control to read.
    expect(sheet).toMatch(/\{cats\.length > COLLAPSED && \(\s*<View style=\{styles\.catSearch\}>/);
  });

  it("shows every match rather than collapsing a list somebody just narrowed", () => {
    expect(sheet).toMatch(/showAllCats \|\| catQuery\.trim\(\) !== ""/);
  });

  it("says so when a word matches nothing", () => {
    // An empty gap where chips were reads as the sheet having broken.
    expect(sheet).toMatch(/No category matches/);
  });
});

/**
 * THE SAME QUESTIONS, ON THE LIST OF SHOPS.
 *
 * "Grocery screen jahan sari shops list, wahan filter jo kaha tha."
 *
 * Open now and Free delivery went to the product AISLE first, because that is
 * where filters were asked for. They belong on a list of shops more: the aisle
 * is a list of things, this is a list of shops, and "is it open" is a question
 * about a shop. Somebody on the Grocery tab at nine in the evening was reading
 * a page of names, half of them shut, with no way to say so.
 */
describe("the shops list can be narrowed too", () => {
  const bar = read("src/modules/marketplace/components/ShopFilters.tsx");
  const screen = read("src/modules/marketplace/screens/MarketScreen.tsx");
  const svc = read("src/modules/marketplace/services/marketplaceService.ts");

  it("offers the three questions a shop can answer", () => {
    expect(bar).toMatch(/label="Open now"/);
    expect(bar).toMatch(/label="Free delivery"/);
    expect(bar).toMatch(/label="4★ and up"/);
  });

  it("uses the SAME parameter names the aisle uses", () => {
    // One vocabulary, so a filter means the same thing wherever it is asked —
    // and a shopper's choice could be carried between the two screens without
    // being translated on the way.
    for (const key of ["open_now", "free_delivery", "rating_min"]) {
      expect(`${key}: ${bar.includes(key)}`).toBe(`${key}: true`);
    }
  });

  it("sends them to the server rather than filtering the page it has", () => {
    // The list pages. Filtering what happens to be loaded would hide shops
    // that are open and further down.
    expect(svc).toMatch(/open_now: params\.open_now \? 1 : undefined/);
    expect(svc).toMatch(/free_delivery: params\.free_delivery \? 1 : undefined/);
    expect(svc).toMatch(/rating_min: params\.rating_min \?\? undefined/);
  });

  it("keeps the shopper's choice apart from the screen's own", () => {
    // The trade and the pin are what the SCREEN decided; a filter must never
    // be able to clear those.
    expect(screen).toMatch(/const \[filters, setFilters\] = useState<ShopQuery>\(\{\}\)/);
    expect(screen).toMatch(/\.\.\.filters,\s*search: debounced,\s*business_type: businessType,/);
  });

  it("sits outside the list, not in its header", () => {
    // It stays put while the list scrolls, which is what a filter bar is for
    // — and a header row inside a virtualised list is the shape that crashed
    // the shop page twice.
    const before = screen.slice(0, screen.indexOf("<FlatList"));
    expect(before).toMatch(/<ShopFilters\b/);
    expect(before).toMatch(/value=\{filters\}/);
  });

  it("puts the city and the distance in a sheet, not on the bar", () => {
    // A pill answers a question with ONE answer — open, free delivery, four
    // stars. A city has forty answers and a distance has a scale; neither fits
    // on a bar somebody scrolls sideways. Same split the aisle already uses.
    const sheet = read("src/modules/marketplace/components/ShopFilterSheet.tsx");
    expect(sheet).toMatch(/<BottomSheet/);
    expect(sheet).toMatch(/City/);
    expect(sheet).toMatch(/Within \$\{km\} km/);

    // The button is FIRST on the bar — the end of a sideways scroll is a place
    // nobody discovers, and this is the way to everything the bar leaves out.
    // By POSITION, not by a character budget between them: the first version
    // allowed 400 characters and the button's own markup is longer than that,
    // so the assertion was really about how much JSX fits in a window.
    expect(bar.indexOf("styles.allPill")).toBeGreaterThan(-1);
    expect(bar.indexOf("styles.allPill")).toBeLessThan(bar.indexOf("<Pill"));
  });

  it("badges the button with the sheet's OWN filters only", () => {
    // Counting the pills too would badge the button for something already
    // visible as a filled pill an inch away, and a count that disagrees with
    // what the eye can see is a count nobody reads.
    expect(bar).toMatch(/const inSheet = \(value\.city_id \? 1 : 0\) \+ \(value\.radius \? 1 : 0\)/);
  });

  it("applies the sheet on Show rather than on every tap", () => {
    // Each change refetches a list nobody is looking at — and without a draft
    // there is no way back from a filter somebody was only trying out.
    const sheet = read("src/modules/marketplace/components/ShopFilterSheet.tsx");
    expect(sheet).toMatch(/const \[draft, setDraft\] = React\.useState<ShopQuery>\(value\)/);
    expect(sheet).toMatch(/if \(visible\) setDraft\(value\)/);
    expect(sheet).toMatch(/onApply\(draft\)/);
  });

  it("does not offer a shop a control only a product has", () => {
    // A shop has no size and no sale price. Reusing the aisle's bar would have
    // meant a control with nothing behind it, which is the thing this app
    // keeps finding and deleting.
    // Matched against how a FILTER is written — `value.x` and `set({ x` —
    // rather than the bare word: `\bsize\b` also matches `size={13}` on an
    // icon, which is an assertion about nothing.
    for (const key of ["min_price", "max_price", "size", "on_sale"]) {
      expect(`${key}: ${new RegExp(`value\\.${key}\\b|set\\(\\{ ${key}\\b`).test(bar)}`).toBe(
        `${key}: false`,
      );
    }
  });
});

/**
 * A SIDEWAYS BAR MUST NOT TAKE THE WHOLE SCREEN.
 *
 * "why too much space here?" — four hundred points of brand green between the
 * filter pills and the first shop.
 *
 * A horizontal `ScrollView` in a flex COLUMN still takes its height from the
 * column, so with nothing to stop it, it grows to fill whatever is left. The
 * pills sit at the top of that and the rest is empty. It looks like a padding
 * mistake and is not: the content container's padding sizes the bar correctly,
 * and the bar was sizing itself to the screen.
 *
 * Both bars had it. Only one had been looked at.
 */
describe("a horizontal filter bar is as tall as its pills", () => {
  it.each([
    ["src/modules/marketplace/components/ShopFilters.tsx", "the shops list"],
    ["src/modules/marketplace/components/QuickFilters.tsx", "the aisle"],
  ])("%s constrains its own height", (rel) => {
    const src = read(rel);

    // On the ScrollView's OWN style, not the content container: the content
    // container cannot stop its parent growing.
    expect(src).toMatch(/style=\{styles\.bar\}/);
    expect(src).toMatch(/bar: \{ flexGrow: 0 \}/);

    // …and the padding that sizes the pills is still on the CONTENT, or the
    // fix would have taken the spacing with it.
    expect(src).toMatch(/contentContainerStyle=\{styles\.barContent\}/);
    expect(src).toMatch(/barContent: \{[\s\S]*?paddingHorizontal: spacing\.md/);
  });
});

describe("distance reaches the server", () => {
  it("is sent, and only when it is set", () => {
    // The server applies it only when a pin came with the request — so a
    // filter that never left the phone would look like a broken control
    // rather than a missing location.
    const svc = read("src/modules/marketplace/services/marketplaceService.ts");
    expect(svc).toMatch(/radius: params\.radius \?\? undefined/);
  });

  it("says out loud that it needs a location", () => {
    const sheet = read("src/modules/marketplace/components/ShopFilterSheet.tsx");
    expect(sheet).toMatch(/Distance needs your location/);
  });
});
