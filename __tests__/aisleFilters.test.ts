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
