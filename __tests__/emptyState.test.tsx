import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import { ThemeProvider } from "../src/theme";
import { EmptyState } from "../src/common/ui/EmptyState";
import { BagIcon } from "../src/common/ui/icons";

/**
 * A SCREEN WITH NOTHING ON IT STILL HAS TO LOOK MADE.
 *
 * Measured before it was fixed: of thirteen empty states in this app, four had
 * an icon and ONE was vertically centred. The rest were two lines of grey text
 * under the header, at the top of an otherwise blank screen — which does not
 * read as "there is nothing here", it reads as content that failed to load and
 * stopped halfway.
 *
 * That matters most where empty is NORMAL. A new customer has no orders, no
 * addresses, no favourites and no reviews: the first four screens they open
 * are all empty, and all four were telling them something had gone wrong.
 */

const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

const words = (tree: ReactTestRenderer.ReactTestRenderer): string[] =>
  tree.root
    .findAllByType("Text" as never)
    .map((n) => {
      const kids = Array.isArray(n.props.children) ? n.props.children : [n.props.children];
      return kids.filter((k: unknown) => typeof k === "string" || typeof k === "number").join("");
    })
    .filter((s) => s.length > 0);

describe("what it draws", () => {
  it("says the title, the reason, and the way out", async () => {
    const onPress = jest.fn();
    const tree = await render(
      <EmptyState
        icon={BagIcon}
        title="No orders yet"
        message="Everything you order shows up here."
        action={{ label: "Browse shops", onPress }}
      />,
    );
    expect(words(tree)).toEqual([
      "No orders yet",
      "Everything you order shows up here.",
      "Browse shops",
    ]);
  });

  it("draws a mark, so four identical grey paragraphs can be told apart", async () => {
    const tree = await render(<EmptyState icon={BagIcon} title="Nothing" />);
    expect(tree.root.findAllByType("Path" as never).length).toBeGreaterThan(0);
  });

  it("needs neither a message nor an action", async () => {
    const tree = await render(<EmptyState icon={BagIcon} title="Nothing" />);
    expect(words(tree)).toEqual(["Nothing"]);
  });

  it("centres itself, and GROWS rather than flexes", async () => {
    // `flex: 1` inside a list's content container resolves against a parent
    // with no height of its own; growing takes whatever the list gives.
    const tree = await render(<EmptyState icon={BagIcon} title="Nothing" />);
    const wrap = tree.root.findAllByType("View" as never)[0];
    const flat = [wrap.props.style].flat(3).filter(Boolean) as any[];
    const style = Object.assign({}, ...flat);

    expect(style.justifyContent).toBe("center");
    expect(style.alignItems).toBe("center");
    expect(style.flexGrow).toBe(1);
    expect(style.flex).toBeUndefined();
  });
});

describe("every list that can be empty says so properly", () => {
  const files = sourceFiles(path.join(PROJECT_ROOT, "src")).filter((f) => f.endsWith(".tsx"));

  it("scanned the app", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("has no hand-rolled empty state left", () => {
    // Thirteen copies is thirteen chances to leave the icon off. The one
    // exception is a HORIZONTAL rail inside a scrolling page, where a
    // full-screen centred panel would be a hole in the middle of the home
    // screen — and that one says so where it is written.
    const offenders = files
      .filter((f) => !f.endsWith("common/ui/EmptyState.tsx"))
      .flatMap((f) => {
        const src = codeOnly(fs.readFileSync(f, "utf8"));
        return /\bemptyTitle\b|\bemptyWrap\b/.test(src)
          ? [`  ${path.relative(PROJECT_ROOT, f)}`]
          : [];
      });

    expect(offenders.join("\n")).toBe("");
  });

  it("gives every one of them a screen to centre in", () => {
    /**
     * THE HALF THAT DOES NOT WORK WHERE IT IS WRITTEN.
     *
     * `ListEmptyComponent` is laid out inside the content container, and a
     * content container is only as tall as its content — so centring inside
     * the component does nothing until the LIST says `flexGrow: 1`. That
     * split is exactly why the centring kept being left out, and it is why
     * this is checked from the list's side.
     */
    const offenders = files.flatMap((f) => {
      const src = codeOnly(fs.readFileSync(f, "utf8"));
      // Only where it is a LIST's empty component. Used as a screen's own
      // body — the cart, which returns early with it — the parent is already
      // a full-height flex column and `flexGrow` on the panel is enough.
      if (!/ListEmptyComponent=\{[\s\S]{0,400}?<EmptyState\b/.test(src)) return [];
      /**
       * The list has to USE it, not merely declare it. Asserting that the file
       * contains `flexGrow: 1` passed while the style sat unreferenced and the
       * content container had gone back to `styles.list` alone.
       *
       * ── One level of indirection, deliberately ────────────────────
       *
       * `contentContainerStyle={[a, b]}` builds a new ARRAY every render, so a
       * list that re-renders while scrolling sees its container style change
       * and re-lays out. The fix is to memoise the array — which means the
       * prop is now an identifier, and a guard that only understood the inline
       * form reported the screen that had just been made faster.
       *
       * So: read whatever is passed, and if it is a name, look that name up.
       * Anything deeper than one hop is not followed, on purpose — a rule that
       * chases arbitrary indirection is a rule nobody can predict.
       */
      // EVERY occurrence, not the first. A screen with a horizontal filter bar
      // above its list has two of these props, and reading only one reported
      // the wrong verdict about whichever came second.
      const grow = [...src.matchAll(/contentContainerStyle=\{([\s\S]*?)\}[\s\S]{0,2}\n/g)].some(
        (m) => {
          const passed = m[1];
          const named = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(passed)?.[1];

          const expr = named
            ? // The identifier's own initialiser — `const listStyle = …;`
              new RegExp(`const ${named}\\s*=[\\s\\S]*?;`).exec(src)?.[0] ?? ""
            : passed;

          return /\b(grow|listGrow)\b/.test(expr);
        },
      );

      return grow ? [] : [`  ${path.relative(PROJECT_ROOT, f)}`];
    });

    expect(offenders.join("\n")).toBe("");
  });

  it("uses it on the screens where empty is the NORMAL first visit", () => {
    // The denominator. A scan that matched nothing would report a clean sweep
    // of an app with no empty states at all.
    const users = files.filter((f) => /<EmptyState\b/.test(fs.readFileSync(f, "utf8")));
    expect(users.length).toBeGreaterThanOrEqual(10);

    for (const name of [
      "OrdersScreen",
      "AddressesScreen",
      "FavoritesScreen",
      "NotificationsScreen",
      "ReviewsScreen",
      "RiderHomeScreen",
    ]) {
      expect(`${name}: ${users.some((f) => f.endsWith(`${name}.tsx`))}`).toBe(`${name}: true`);
    }
  });
});
