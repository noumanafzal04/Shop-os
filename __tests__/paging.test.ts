import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";

/**
 * A LIST SHOWS EVERYTHING, NOT ITS FIRST PAGE.
 *
 * ── The gap this closes ──────────────────────────────────────────────
 *
 * Every marketplace endpoint has paged from the beginning — twenty-four
 * products, twenty shops, fifteen orders — and the app asked for page one and
 * stopped. A shop with four hundred items had twenty-four, and the aisle's own
 * header printed "24+" because the screen knew it was not telling the truth.
 *
 * Nothing announced it. A short list looks exactly like a small catalogue.
 *
 * ── The two mistakes an infinite list makes ──────────────────────────
 *
 * Both are guarded below, because both are silent:
 *
 *   1. `onEndReached` fires MORE THAN ONCE while a list settles. Without the
 *      in-flight check that is two identical requests for page two, and on a
 *      throttled API it is the fastest way to a 429.
 *   2. `getNextPageParam` that never returns undefined loops for ever on the
 *      last page — a list that quietly refetches the same rows until the
 *      screen is closed.
 */

const ROOT = PROJECT_ROOT;

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("the lists that page", () => {
  const files = sourceFiles(path.join(ROOT, "src"));

  const infinite = files.filter((f) => /useInfiniteQuery\(/.test(codeOnly(fs.readFileSync(f, "utf8"))));

  it("found them", () => {
    // The aisle, the shop list and the orders list. If this drops, the rules
    // below would pass by checking nothing.
    expect(infinite.length).toBeGreaterThanOrEqual(2);
  });

  it("every one of them knows when to stop", () => {
    /**
     * COUNTED, not merely present.
     *
     * The first version asked whether the stop condition appeared in each
     * FILE. `useMarketplace.ts` holds two infinite queries, so breaking one of
     * them left the other's line matching and the guard green — which a
     * mutation proved on the first try. A rule about every query has to be
     * counted per query, not per file.
     */
    let checked = 0;

    for (const file of infinite) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));

      const queries = [...src.matchAll(/getNextPageParam/g)].length;
      // The last page returns undefined; without it the list asks for the same
      // page for ever. And a response with NO pagination is an endpoint that
      // answered in full, not one with more to give.
      const stops = [...src.matchAll(/current_page >= p\.last_page\) return undefined/g)].length;
      const guards = [...src.matchAll(/p == null \|\|/g)].length;

      expect(queries).toBeGreaterThan(0);
      expect(stops).toBe(queries);
      expect(guards).toBe(queries);
      checked += queries;
    }

    // The denominator, stated: four paged lists today.
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it("no screen asks for the next page while one is already in flight", () => {
    /**
     * THE HANDLER'S OWN BODY, not four hundred characters after it.
     *
     * The first version sliced a fixed window, which reached past the handler
     * into `ListFooterComponent` — where `isFetchingNextPage` legitimately
     * appears. So deleting the guard from the handler left the window still
     * matching, and a mutation walked straight through it.
     */
    const HANDLER = /onEndReached=\{\(\) => \{([\s\S]*?)\n\s*\}\}/g;
    const offenders: string[] = [];
    let seen = 0;

    for (const file of files) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));

      for (const m of src.matchAll(HANDLER)) {
        seen += 1;
        if (!/isFetchingNextPage/.test(m[1])) {
          offenders.push(`  ${path.relative(ROOT, file)}`);
        }
      }
    }

    expect(seen).toBeGreaterThanOrEqual(4);
    expect(offenders.join("\n")).toBe("");
  });

  it("fetches before the bottom, not at it", () => {
    // Fetching at the very end means the spinner is what somebody sees.
    const screens = files.filter((f) => /onEndReached=/.test(codeOnly(fs.readFileSync(f, "utf8"))));

    expect(screens.length).toBeGreaterThanOrEqual(2);
    for (const file of screens) {
      expect(codeOnly(fs.readFileSync(file, "utf8"))).toMatch(/onEndReachedThreshold=\{0\.5\}/);
    }
  });

  it("no screen still reads a single page off an infinite query", () => {
    // `list.data.data` is the shape of a plain query. On an infinite one it is
    // undefined, and the list renders empty with no error anywhere.
    const offenders = files
      .flatMap((f) =>
        codeOnly(fs.readFileSync(f, "utf8"))
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /\b(list|shops|orders)\.data\?\.data\b/.test(line))
          .map(([n]) => `  ${path.relative(ROOT, f)}:${n}`),
      );

    expect(offenders.join("\n")).toBe("");
  });
});

/**
 * A SHOP'S MENU IS READ WHOLE.
 *
 * Two bugs lived in one line — `useMarketProducts(slug, …)`, which asks for
 * page one and nothing else, on an endpoint that pages at twenty.
 */
describe("the shop menu", () => {
  const src = fs.readFileSync(
    path.join(PROJECT_ROOT, "src/modules/marketplace/hooks/useMarketplace.ts"),
    "utf8",
  );
  /**
   * COMMENTS STRIPPED.
   *
   * The rule below is "no `stickyHeaderIndices` anywhere", and the docblock
   * that explains WHY it was removed names it four times. A guard that cannot
   * tell a rule from the description of a rule fails on the commit that writes
   * the rule down — twice in one day, in this repo.
   */
  const screen = fs
    .readFileSync(
      path.join(PROJECT_ROOT, "src/modules/marketplace/screens/MarketShopScreen.tsx"),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("reaches past page one", () => {
    // A restaurant with a thirty-item menu had ten items that could not be
    // reached by any gesture on that screen — not hard to reach, unreachable,
    // and the screen gave no sign there was more.
    expect(src).toMatch(/export function useShopMenu/);
    expect(src).toMatch(/useInfiniteQuery/);
    expect(screen).toMatch(/useShopMenu\(slug/);
    expect(screen).not.toMatch(/useMarketProducts\(slug/);
  });

  it("keeps asking until it has all of it", () => {
    // The chips jump to a section, so a section that has not been scrolled to
    // yet still has to exist. Guarded on `isFetchingNextPage`, or the effect
    // re-requests page two on every render that page one causes.
    expect(src).toMatch(/if \(hasNextPage && !isFetchingNextPage\) void fetchNextPage\(\)/);
  });

  it("makes the category chips a contents page, not a filter", () => {
    // Pressing "Burgers" used to refetch with `category_id`, so the rest of
    // the menu disappeared and came back over the network.
    expect(screen).toMatch(/listRef\.current\?\.scrollToIndex\(\{[\s\S]{0,160}?viewPosition: 0,/);
    expect(screen).not.toMatch(/category_id: catId/);
  });

  it("survives a jump into rows nothing has measured yet", () => {
    // `scrollToIndex` past the measured window is an exception, not a near
    // miss — and only ever on a device.
    // The prop, not a name that merely CONTAINS it: the first version of this
    // matched `onScrollToIndexFailedX` — a mutation that renames the handler
    // and silently drops it — because a bare substring is not a prop.
    expect(screen).toMatch(/\bonScrollToIndexFailed=\{/);
  });

  it("never re-parents a row or steals the list's scroll events", () => {
    /**
     * TWO CRASHES, ONE ERROR, TWO CAUSES.
     *
     *     addViewAt: failed to insert view [3320] into parent [2750] at index 50
     *     index=50 count=1      SurfaceMountingManager.kt:389
     *
     * `stickyHeaderIndices` re-parents the sticky row into a wrapper of its
     * own, and doing that to a row inside a VIRTUALISED list is two trees
     * disagreeing about one view. Then `Animated.event` with the native driver
     * on a plain FlatList's `onScroll` took the JS scroll events away from
     * `VirtualizedList`, which needs them to decide what stays rendered.
     *
     * THESE TWO ARE THE PERMANENT RULE. Everything else about how the bar
     * behaves has now changed twice, and both crashes came from these two
     * mechanisms rather than from the idea of a bar that sticks.
     */
    expect(screen).not.toMatch(/stickyHeaderIndices/);
    expect(screen).not.toMatch(/onScroll=\{Animated\.event/);

    // A plain JS listener is the only kind allowed to touch this list.
    expect(screen).toMatch(/onScroll=\{onScroll\}/);
    expect(screen).toMatch(/scrollEventThrottle=\{16\}/);
  });

  it("puts the bar under the shop and pins it when it reaches the top", () => {
    /**
     * A DECISION REVERSED, AND WHY THE OLD TEST IS NOT SIMPLY DELETED.
     *
     * After the crashes the bar became ONE element outside the list,
     * permanently above it — safe, and reported as wrong: "tab category sbse
     * top py q rkh / niche e rlh, jb scroll ho tb opr ja k sticky ho".
     *
     * So it is drawn twice again — as a row in the list, and as an absolutely
     * positioned copy that appears once the row has left the screen. Two
     * ELEMENTS is not the thing that crashed; re-parenting one element was.
     */
    // In the flow, as a row of its own.
    expect(screen).toMatch(/\| \{ kind: "cats"; key: string \}/);
    expect(screen).toMatch(/out\.unshift\(\{ kind: "cats", key: "cats" \}\)/);

    // And a second copy, only while pinned.
    expect(screen).toMatch(/jumps\.size > 1 && pinned && \(/);
    expect((screen.match(/<CatBar\b/g) ?? []).length).toBe(2);
    expect(screen).toMatch(/function CatBar\(/);
  });

  it("moves every jump index when it puts a row in front of them", () => {
    /**
     * The bug this would otherwise be.
     *
     * `jumps` records the row number of each heading. Unshifting the cats row
     * after that map is built leaves every index one short, so every chip
     * lands on the LAST PRODUCT of the previous category — a jump that looks
     * like it worked and goes to the wrong place.
     *
     * So the map is rebuilt with the offset, not patched.
     */
    expect(screen).toMatch(/new Map\(\[\.\.\.at\]\.map\(\(\[name, i\]\) => \[name, i \+ 1\]\)\)/);
  });

  it("measures the threshold from the header, which is the only reliable one", () => {
    /**
     * The obvious version read `layout.y` off the cats row. That is always 0 —
     * `FlatList` wraps every `renderItem` result in a cell container, so a
     * row's layout is relative to that wrapper. The pin condition would have
     * been `offset >= 0`, or with a zero guard, a bar that never appeared and
     * nothing to say why.
     */
    expect(screen).toMatch(/headerH\.current = e\.nativeEvent\.layout\.height/);
    expect(screen).toMatch(/contentOffset\.y >= headerH\.current/);
    // Not the row's position, which is the trap.
    expect(screen).not.toMatch(/catsY/);
  });

  it("does not call setState on every scroll frame", () => {
    // A `setState` per frame is the jank this screen was reported for. The
    // listener flips a ref first and returns early when nothing changed.
    expect(screen).toMatch(/if \(should === pinnedRef\.current\) return;/);
  });

  it("does not let Android detach the rows underneath it", () => {
    // Android's default for a virtualized list is to DETACH the native views
    // of rows that scroll out — a memory win, and on Fabric the shortest path
    // to the native and shadow trees disagreeing about a container's children.
    // This list is one shop's menu, not the marketplace aisle.
    expect(screen).toMatch(/removeClippedSubviews=\{false\}/);
  });

  it("does not rebuild its header on every render", () => {
    // `const header = (…)` is a fresh element each time, and
    // `ListHeaderComponent` takes it at face value: the hero, the identity
    // block, the search box and two horizontal scrollers torn down and
    // rebuilt — repeatedly, while the menu arrives a page at a time under a
    // native list trying to keep its children in step.
    expect(screen).toMatch(/const header = React\.useMemo\(/);
    // And the memo must not depend on something that changes while scrolling.
    const deps = /\n\s*\[shop\.data[^\]]*\],/.exec(screen)?.[0] ?? "";
    expect(deps).not.toMatch(/\bsection\b/);
    expect(deps).not.toMatch(/\bjumps\b/);
  });

  it("lands a jump BELOW the pinned bar, not underneath it", () => {
    // `scrollToIndex` puts a row at the very top of the viewport, and the top
    // of the viewport is where the bar now is — so without the offset every
    // jump hid the heading it had just been asked to go to.
    // BOTH scroll calls — the jump and the retry after a failed index. One
    // assertion passed while either one had lost its offset, because the other
    // still carried the string.
    expect((screen.match(/viewOffset: CHIP_BAR/g) ?? []).length).toBe(2);
    expect((screen.match(/scrollToIndex\(\{/g) ?? []).length).toBe(2);
    expect(screen).toMatch(/const CHIP_BAR = \d+;/);
  });

  it("draws no bar at all for a shop with one section", () => {
    /**
     * A contents page listing one thing is a label, not a contents page.
     *
     * Checked in BOTH places now, which is the half that was easy to miss: the
     * row is only added to the menu when there is more than one category, and
     * the pinned copy is only rendered on the same condition. Guard one and
     * not the other and a single-section shop gets an empty bar over its
     * first product.
     */
    expect(screen).toMatch(/if \(at\.size > 1\) \{/);
    expect(screen).toMatch(/jumps\.size > 1 && pinned/);
  });

  it("holds its viewability config still", () => {
    // A fresh object each render makes FlatList throw "Changing
    // viewabilityConfig on the fly is not supported".
    expect(screen).toMatch(/const viewability = React\.useRef\(/);
    expect(screen).toMatch(/const onViewable = React\.useRef\(/);
  });
});
