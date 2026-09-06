import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import { ThemeProvider } from "../src/theme";
import { ProductSheet } from "../src/modules/marketplace/components/ProductSheet";

/**
 * THE SHEET EVERY PRODUCT TAP OPENS.
 *
 * Two faults in one screenshot, and both came from the same move — putting
 * this panel onto the shared `BottomSheet`.
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

const base = {
  id: "p1",
  type: "product" as const,
  name: "Cold Coffee",
  description: null,
  price: "350",
  original_price: null,
  brand: null,
  unit: null,
  sold_by: "unit" as const,
  min_order_qty: null,
  duration_minutes: null,
  category: { id: "c", name: "Beverages" },
  images: [],
  in_stock: true,
  available_now: true,
  variants: [],
  modifier_groups: [],
};

const sized = (largeIn: boolean, regularIn: boolean) => ({
  ...base,
  variants: [
    { id: "v1", name: "Large", price: "450", in_stock: largeIn },
    { id: "v2", name: "Regular", price: "350", in_stock: regularIn },
  ],
});

describe("when every size has gone", () => {
  it("refuses to add, rather than adding one with no size", async () => {
    /**
     * THE BUG. `valid` only ever asked about modifier GROUPS, so a product
     * whose sizes had all sold out showed "Choose an option · Required" over
     * two disabled rows, selected nothing, and left "Add to cart" working.
     *
     * The refusal then arrived from the server at checkout — after a basket
     * had been built around an item that could never be in it, which is the
     * worst moment to find out.
     */
    const tree = await render(
      <ProductSheet product={sized(false, false) as any} onClose={() => {}} onAdd={() => {}} />,
    );
    // By `accessibilityState`, not by a `disabled` PROP: React Native hands
    // the host view the state and does not pass the prop straight through, so
    // the first version of this counted zero and would have passed on an app
    // whose Add button was never disabled at all.
    const off = tree.root.findAll(
      (n) => typeof n.type === "string" && n.props.accessibilityState?.disabled === true,
    );

    expect(off.length).toBeGreaterThan(0);
    expect(words(tree)).toContain("Sold out");
    expect(words(tree).join(" ")).not.toMatch(/Add to cart/);
  });

  it("stops saying Required about rows nobody can press", async () => {
    // An instruction that cannot be followed is worse than no instruction.
    const tree = await render(
      <ProductSheet product={sized(false, false) as any} onClose={() => {}} onAdd={() => {}} />,
    );
    const said = words(tree);

    expect(said).not.toContain("Required");
    expect(said).toContain("none left today");
  });

  it("still sells the one size that is left", async () => {
    // The denominator: the rule must not refuse a product that CAN be bought.
    const tree = await render(
      <ProductSheet product={sized(false, true) as any} onClose={() => {}} onAdd={() => {}} />,
    );
    expect(words(tree).join(" ")).toMatch(/Add to cart/);
    expect(words(tree)).toContain("Required");
  });

  it("leaves a product with no sizes alone", async () => {
    const tree = await render(
      <ProductSheet product={base as any} onClose={() => {}} onAdd={() => {}} />,
    );
    expect(words(tree).join(" ")).toMatch(/Add to cart/);
  });
});

describe("the panel pads its own content", () => {
  it("does not run its rows to the glass", () => {
    /**
     * `BottomSheet` pads its head and its footer and NOT its children — on
     * purpose, so a sheet can hold a full-bleed row. This panel's padding used
     * to come from its own `styles.sheet`, which went when it moved onto the
     * shared sheet, and nothing said so: the price, the Required badges and
     * every radio button were sliced off at the right edge.
     */
    const src = codeOnly(
      fs.readFileSync(
        path.join(PROJECT_ROOT, "src/modules/marketplace/components/ProductSheet.tsx"),
        "utf8",
      ),
    );
    expect(src).toMatch(/<View style=\{styles\.body\}>/);
    expect(src).toMatch(/body: \{ paddingHorizontal: spacing\.md/);
  });

  it("is a rule every sheet's caller has to keep", () => {
    // The same trap is one refactor away in any other caller, so it is checked
    // across all of them rather than in the one that fell into it.
    const callers = sourceFiles(path.join(PROJECT_ROOT, "src"))
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /<BottomSheet\b/.test(codeOnly(fs.readFileSync(f, "utf8"))));

    expect(callers.length).toBeGreaterThanOrEqual(2);

    const offenders = callers.filter((f) => {
      const src = codeOnly(fs.readFileSync(f, "utf8"));
      // `padding` OR `paddingHorizontal`: the shorthand is the same promise,
      // and asserting only the long form reported `RateSheet` — which pads
      // itself correctly with `padding: spacing.md`.
      return !/padding(Horizontal)?: spacing\.md/.test(src);
    });

    expect(offenders.map((f) => `  ${path.relative(PROJECT_ROOT, f)}`).join("\n")).toBe("");
  });
});
