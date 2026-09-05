import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";

/**
 * A pushed screen owns its own bottom inset.
 *
 * `edges={["top"]}` is RIGHT for a tab: the floating bar covers the gesture
 * area, and padding it again opens a dead strip under every list. It is wrong
 * for everything else, because nothing sits below a pushed screen — its last
 * row, and on several screens its only button, lands under the gesture bar or
 * the navigation buttons.
 *
 * Seven screens had it: the location picker, search, reservations, favourites,
 * order tracking, notifications and addresses. All seven look correct on an
 * emulator with no gesture bar, which is why this is a rule and not a fix.
 */

const ROOT = PROJECT_ROOT;
const NAV = path.join(ROOT, "src/navigation/RootNavigator.tsx");

function componentsOn(navigator: "CustomerTabs" | "CustomerStack"): Set<string> {
  const src = fs.readFileSync(NAV, "utf8");
  const re = new RegExp(`<${navigator}\\.Screen[^>]*?component=\\{(\\w+)\\}`, "gs");
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) found.add(m[1]);
  return found;
}

/**
 * Source with its comments removed.
 *
 * A guard that greps raw text cannot tell prose from code — and the file this
 * one checks explains, in a docblock, exactly why `useSafeAreaInsets()` is
 * wrong there. Matching the explanation of a bug as though it were the bug is
 * how a guard ends up permanently red for the right reason.
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function fileFor(component: string): string | null {
  return (
    sourceFiles(path.join(ROOT, "src")).find((f) =>
      new RegExp(`export function ${component}\\b`).test(fs.readFileSync(f, "utf8")),
    ) ?? null
  );
}

describe("the tab bar's own inset", () => {
  const src = codeOnly(
    fs.readFileSync(path.join(ROOT, "src/navigation/AppTabBar.tsx"), "utf8"),
  );

  it("comes from the navigator, not from the hook", () => {
    // React Navigation renders a custom tab bar inside a context whose bottom
    // inset is ZERO — it treats the inset as its own to spend and hands the
    // real figure to the bar as a prop. `useSafeAreaInsets()` is correct on
    // every other screen in this app and returns 0 here, so
    // `Math.max(insets.bottom, 8)` gave the bar eight points of clearance
    // under a forty-eight point navigation bar: the labels touched the
    // buttons and the basket disc was cut in half.
    //
    // Nothing looked wrong on a gesture-navigation emulator, where 8 nearly
    // covers the inset. It took a photograph of a real phone.
    expect(src).not.toMatch(/useSafeAreaInsets\(/);
    expect(src).toMatch(/\{\s*state,\s*navigation,\s*insets\s*\}: BottomTabBarProps/);
  });

  it("still spends it", () => {
    // Reading the prop and not using it would be the same bug with a longer
    // signature.
    expect(src).toMatch(/paddingBottom: Math\.max\(insets\.bottom/);
  });
});

describe("a bar pinned with `position: absolute`", () => {
  it("adds the inset itself", () => {
    const src = codeOnly(
      fs.readFileSync(
        path.join(ROOT, "src/modules/marketplace/screens/MarketShopScreen.tsx"),
        "utf8",
      ),
    );

    // An absolutely-positioned child does NOT sit inside its parent's
    // paddingBottom — Yoga measures `bottom` from the border box. So
    // `SafeScreen`'s inset, which correctly holds the LIST clear of the
    // navigation bar, does nothing for the sticky cart bar: on a phone with
    // three-button navigation it sat underneath the buttons with
    // "View cart · Rs 3,980" showing through them.
    expect(src).toMatch(/bottom: insets\.bottom \+ spacing\.md/);
  });
});

describe("bottom safe area", () => {
  const tabs = componentsOn("CustomerTabs");
  const stack = componentsOn("CustomerStack");

  // A count of findings is not evidence without a count of attempts.
  it("found both navigators", () => {
    expect(tabs.size).toBeGreaterThanOrEqual(5);
    expect(stack.size).toBeGreaterThanOrEqual(8);
  });

  const pushedOnly = [...stack].filter((c) => !tabs.has(c) && c !== "CustomerTabsArea");

  it.each(pushedOnly.map((c) => [c] as const))("%s does not pin edges to the top", (component) => {
    const file = fileFor(component);
    expect(file).not.toBeNull();
    const src = fs.readFileSync(file!, "utf8");
    expect(src).not.toMatch(/edges=\{\["top"\]\}/);
  });

  it("answers per-instance where a screen is BOTH a tab and pushed", () => {
    // `MarketScreen` is the Grocery tab and `ShopList`. One component cannot
    // have one answer written into its JSX, so it has to compute it.
    const both = [...stack].filter((c) => tabs.has(c));
    expect(both.length).toBeGreaterThan(0);

    for (const component of both) {
      const src = fs.readFileSync(fileFor(component)!, "utf8");
      expect(src).not.toMatch(/edges=\{\["top"\]\}/);
      expect(src).toMatch(/edges=\{\w+ \? \["top"\] : \["top", "bottom"\]\}/);
    }
  });
});
