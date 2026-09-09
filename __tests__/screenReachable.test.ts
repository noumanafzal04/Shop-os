import { PROJECT_ROOT, codeOnly, fs, path, sourceFiles, statementAt } from "./support/node";

/**
 * EVERY SCREEN CAN BE OPENED.
 *
 * ── The bug class ────────────────────────────────────────────────────
 *
 * A screen that is written, styled, tested and registered in the navigator —
 * and that nothing anywhere navigates to. It raises no error. It has no
 * failing test. It simply never appears, and the work in it is invisible until
 * somebody asks why a feature they remember building is not in the app.
 *
 * This has happened repeatedly on the web side of this product (a settings
 * screen nothing linked to, a module with no menu entry, a stock report
 * reachable only by typing a URL) and there was no equivalent check here at
 * all. The new "All categories" screen is exactly the shape that goes missing:
 * one entry point, on one tile, in one grid.
 *
 * ── The two halves ───────────────────────────────────────────────────
 *
 * REGISTERED — the navigator knows the component. Without this the route name
 * throws at runtime, which is at least loud.
 *
 * REACHED — something names that route. Silent, and the half worth a guard.
 *
 * ── Why the exceptions are named rather than pattern-matched ─────────
 *
 * The first version of this scan reported ten screens and was wrong about all
 * ten: four are tab screens reached by pressing a tab, and six are named in a
 * data array as `route: "Help"` rather than in a literal `navigate("Help")`
 * call. A guard whose first run is ten false positives is a guard nobody reads
 * the output of, so it understands both shapes now.
 */

const nav = codeOnly(
  fs.readFileSync(path.join(PROJECT_ROOT, "src/navigation/RootNavigator.tsx"), "utf8"),
);

/** Every `.tsx` under a `screens/` folder — the app's own naming convention. */
const screens = sourceFiles(path.join(PROJECT_ROOT, "src"))
  .filter((f) => /[/\\]screens[/\\][A-Za-z]+Screen\.tsx$/.test(f))
  .map((f) => path.basename(f).replace(".tsx", ""));

/** Everything else, as one blob to look for route names in. */
const app = sourceFiles(path.join(PROJECT_ROOT, "src"))
  .map((f) => codeOnly(fs.readFileSync(f, "utf8")))
  .join("\n");

/**
 * Screens that are ENTERED BY BEING THE STACK, not by a call.
 *
 * The third shape this detector did not know about, and the third time its
 * first run was wrong about the app rather than right. Listed by name with the
 * reason, because a pattern that recognised "sole screen inside a conditional
 * branch of a navigator" would be a regex about JSX structure — fragile, and
 * unreadable at the moment it fails.
 *
 * Adding a name here is easy. What it is not is silent.
 */
const ENTERED_BY_SESSION_STATE: Record<string, string> = {
  // A shop owner or admin signing in has a real session and nowhere to spend
  // it in a customer app, so this REPLACES the stack and says so. Nothing
  // navigates to it because there is nothing else mounted to navigate from.
  BusinessAccountScreen: "the whole stack for a non-customer session",
};

/** component name → route name, from the navigator itself. */
const routeOf = new Map(
  [...nav.matchAll(/name="([A-Za-z]+)"\s+component=\{(\w+)\}/g)].map((m) => [m[2], m[1]]),
);

describe("no screen is written and left unreachable", () => {
  it("found the screens and the navigator", () => {
    // THE DENOMINATOR. A glob that matched nothing, or a navigator whose
    // registration syntax changed, would report a clean sweep of an empty set.
    expect(screens.length).toBeGreaterThan(20);
    expect(routeOf.size).toBeGreaterThan(20);
  });

  it("registers every one of them", () => {
    const missing = screens.filter((s) => !routeOf.has(s));
    expect(missing).toEqual([]);
  });

  it("has a way in to every route", () => {
    const unreachable = screens.filter((s) => {
      if (s in ENTERED_BY_SESSION_STATE) return false;

      const route = routeOf.get(s);
      if (route == null) return false; // the test above owns that case

      // A tab is reached by pressing it. `Tabs`/`RiderTabs` are the two
      // navigators themselves and are entered by the mode switch.
      if (/Tab$/.test(route) || route === "Tabs" || route === "RiderTabs") return false;

      return (
        // `navigation.navigate("Help")`
        !new RegExp(`navigate\\(\\s*"${route}"`).test(app) &&
        // `{ label: "Help", route: "Help" }` — a menu row in a data array,
        // navigated through a variable. Six screens are reached only this way.
        !new RegExp(`route:\\s*"${route}"`).test(app) &&
        // `navigate(to.route, to.params)` from a notification target map.
        !new RegExp(`route:\\s*"${route}"`).test(app)
      );
    });

    expect(unreachable).toEqual([]);
  });

  it("does not excuse a screen that no longer exists", () => {
    // The list rots both ways: a screen deleted or made navigable leaves a
    // reason here explaining nothing, and the next person reads it as a rule.
    const stale = Object.keys(ENTERED_BY_SESSION_STATE).filter((k) => !screens.includes(k));
    expect(stale).toEqual([]);
  });

  it("has a way in to All categories specifically", () => {
    /**
     * Named on its own because this is the screen the guard was written
     * alongside, and because it went unreachable ON LIVE for a whole release.
     *
     * The tile was drawn under `business_types.length > tradeTiles.length`.
     * The server sends the trades that HAVE shops; live had exactly four and
     * the grid shows four, so `4 > 4` was false and the only way in did not
     * render. A registered, routed, tested screen that nobody could open.
     *
     * So the entry point is asserted UNCONDITIONAL, not merely present.
     */
    const home = codeOnly(
      fs.readFileSync(
        path.join(PROJECT_ROOT, "src/modules/marketplace/screens/CustomerHomeScreen.tsx"),
        "utf8",
      ),
    );

    expect(home).toMatch(/navigate\("Categories"\)/);

    const lines = home.split("\n");
    const label = lines.findIndex((l) => l.includes('accessibilityLabel="View all categories"'));
    expect(label).toBeGreaterThan(-1);

    // The element the label belongs to, then the line that decides whether it
    // is drawn at all.
    const tag = lines.slice(0, label).map((l) => l.trim()).lastIndexOf("<Touchable");
    expect(tag).toBeGreaterThan(-1);

    const before = lines
      .slice(0, tag)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop();

    // `x && (`, `x ? (`, `x &&` — any of them makes the way in depend on
    // something, and something is what was false on live.
    expect(before).not.toMatch(/(&&|\?|\|\|)\s*\(?$/);
    expect(home).not.toMatch(/length > tradeTiles\.length/);
  });

  it("caps the home grid, which is why the screen is needed", () => {
    // The grid wraps, so every trade the server returned meant the whole top
    // half of the home screen was tiles before a single shop appeared.
    const home = codeOnly(
      fs.readFileSync(
        path.join(PROJECT_ROOT, "src/modules/marketplace/screens/CustomerHomeScreen.tsx"),
        "utf8",
      ),
    );

    expect(home).toMatch(/const HOME_TRADES = \d+;/);
    expect(home).toMatch(/\.slice\(0, HOME_TRADES\)/);
  });
});

describe("the categories screen offers the platform's whole breadth, and only what is doable", () => {
  const src = codeOnly(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "src/modules/marketplace/screens/CategoriesScreen.tsx"),
      "utf8",
    ),
  );

  it("reads the labels the server sends", () => {
    /**
     * The app used to build a label by capitalising the CODE, so a mart read
     * "Mart" while `BusinessTypes::all()` has called it "Mart & Grocery" since
     * the type existed. Two names for one thing, and the rougher one on the
     * screen everybody opens first.
     */
    expect(src).toMatch(/\{trade\.label\}/);
    expect(src).toMatch(/\{cat\.label\}/);
    expect(src).not.toMatch(/typeLabel/);
    expect(src).not.toMatch(/charAt\(0\)\.toUpperCase\(\)/);
  });

  it("asks the question home cannot answer", () => {
    /**
     * NOT `useHomeFeed`. It returns the trades that have shops — four of them
     * — so an "All categories" page built on it showed exactly the four rows
     * the home screen already had, and could not name a trade nobody had
     * joined yet or a single category inside one.
     */
    expect(src).toMatch(/useCategories\(/);
    expect(src).not.toMatch(/useHomeFeed/);
  });

  it("keys the counts to the city, not the pin", () => {
    // The counts answer "how many garment shops are there", which is a
    // question about a place. Coordinates would key the cache to every GPS
    // reading and re-ask the same question all day.
    expect(src).toMatch(/useCategories\(\{ city_id: city\?\.id \}\)/);
  });

  it("sends a trade tap to the same screen the home tile does", () => {
    // Two ways in, one destination. A second listing screen for the same rows
    // is how one of them ends up with a fix the other never gets.
    expect(src).toMatch(/navigate\("ShopList", \{ business_type: t\.type, title: t\.label \}\)/);
  });

  it("sends a category tap with the trade as well as the category", () => {
    /**
     * Both. The trade scopes the deals strip on the shop list, so a Garments
     * list shows garment offers rather than whatever the marketplace has
     * discounted today.
     */
    const jump = statementAt(src, src.indexOf("const openCategory"));
    expect(jump).toMatch(/business_type: t\.type/);
    expect(jump).toMatch(/business_category: value/);
  });

  it("refuses to offer a row that leads to an empty list", () => {
    /**
     * The one rule on this page: `shops_count > 0` decides whether a thing can
     * be pressed. A chip that opens an empty list is the shape this codebase
     * keeps finding — offered, and not doable.
     */
    expect(src).toMatch(/const open = trade\.shops_count > 0;/);
    expect(src).toMatch(/const has = cat\.shops_count > 0;/);
    // Not just styled differently — actually inert, both ways round.
    expect(src).toMatch(/onPress=\{open \? \(\) => onOpenTrade\(trade\) : undefined\}/);
    expect(src).toMatch(/disabled=\{!open\}/);
    expect(src).toMatch(/disabled=\{!has\}/);
  });

  it("says shop, not shops, when there is one of them", () => {
    // "1 shops" is the kind of detail that makes an app feel unfinished for
    // the sake of two characters.
    expect(src).toMatch(/trade\.shops_count === 1 \? "shop" : "shops"/);
  });
});
