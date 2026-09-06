import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { PROJECT_ROOT, fs, path } from "./support/node";
import {
  BasketGlyph,
  CartGlyph,
  HomeGlyph,
  ParcelGlyph,
  PersonGlyph,
  ReceiptGlyph,
  WalletGlyph,
} from "../src/common/ui/icons/TabIcons";

/**
 * THE BAR HAS TO SAY WHICH TAB YOU ARE ON.
 *
 * ── The complaint ────────────────────────────────────────────────────
 *
 * "footer icons or baki b — ye bht basic sy hain." It was right, and the fault
 * was not the icon library: every slot was a thin monoline outline in one of
 * two greys, and the only difference between the tab you were on and the four
 * you were not was half a point of stroke width. Nothing in the bar was solid,
 * so nothing in it read as selected.
 *
 * The rules below are the ones that would quietly go again — an icon added
 * with no filled state, an active colour that drifts back to a grey, a slot
 * that changes size and shoves the other four sideways.
 */

const GLYPHS = {
  HomeGlyph,
  BasketGlyph,
  CartGlyph,
  ReceiptGlyph,
  PersonGlyph,
  ParcelGlyph,
  WalletGlyph,
};

/** Every element in a rendered tree, flattened. */
function nodes(tree: ReactTestRenderer.ReactTestRendererJSON | null): any[] {
  if (tree == null) return [];
  const kids = Array.isArray(tree.children) ? tree.children : [];
  return [
    tree,
    ...kids.flatMap((k) => (typeof k === "string" ? [] : nodes(k as any))),
  ];
}

function render(el: React.ReactElement) {
  let out: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    out = ReactTestRenderer.create(el);
  });
  const json = out!.toJSON() as ReactTestRenderer.ReactTestRendererJSON;
  const all = nodes(json);
  out!.unmount();
  return all;
}

describe("each glyph draws, both ways", () => {
  const names = Object.keys(GLYPHS) as Array<keyof typeof GLYPHS>;

  it("has the seven the bar needs", () => {
    // The denominator: the per-glyph checks below prove nothing about a set
    // that has quietly shrunk to one.
    expect(names).toHaveLength(7);
  });

  it.each(names)("%s renders as an outline and as a solid", (name) => {
    const Glyph = GLYPHS[name];

    const outline = render(<Glyph size={22} color="#111111" />);
    const filled = render(<Glyph size={22} color="#E94E00" filled knockout="#FFFFFF" />);

    // Something was actually drawn. A component that returns an empty <Svg/>
    // passes every colour assertion ever written about it.
    const paths = (all: any[]) =>
      all.filter((n) => n.type === "Path" || n.type === "Circle");
    expect(paths(outline).length).toBeGreaterThan(0);
    expect(paths(filled).length).toBeGreaterThan(0);

    // OUTLINE: the shape is stroked and hollow.
    const outlineBody = paths(outline).filter((n) => n.props.stroke === "#111111");
    expect(outlineBody.length).toBeGreaterThan(0);
    expect(outlineBody.every((n) => n.props.fill !== "#111111")).toBe(true);

    // FILLED: at least one shape is actually filled with the colour.
    expect(paths(filled).some((n) => n.props.fill === "#E94E00")).toBe(true);
  });

  it("punches interior detail back out of a filled shape", () => {
    // A filled receipt whose three lines are drawn in the icon's own colour is
    // a solid rectangle. They have to be drawn in whatever is BEHIND the icon.
    const filled = render(
      <ReceiptGlyph size={22} color="#E94E00" filled knockout="#FFFFFF" />,
    );
    const drawn = filled.filter((n) => n.type === "Path");

    expect(drawn.some((n) => n.props.stroke === "#FFFFFF")).toBe(true);
  });

  it("does not paint the knockout when the glyph is an outline", () => {
    // The other half of the same rule: an unselected icon's detail is part of
    // the drawing and must be the icon's colour, not the background's.
    const outline = render(
      <ReceiptGlyph size={22} color="#111111" knockout="#FFFFFF" />,
    );
    const drawn = outline.filter((n) => n.type === "Path");

    expect(drawn.some((n) => n.props.stroke === "#FFFFFF")).toBe(false);
  });

  it("takes the size it is given", () => {
    const svg = render(<HomeGlyph size={30} color="#111111" />).find(
      (n) => n.type === "Svg",
    );
    expect(svg?.props.width).toBe(30);
    expect(svg?.props.viewBox).toBe("0 0 24 24");
  });
});

describe("the bar wires the two states up", () => {
  const src = fs
    .readFileSync(path.join(PROJECT_ROOT, "src/navigation/AppTabBar.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("fills the icon of the tab you are on", () => {
    expect(src).toMatch(/filled=\{focused\}/);
  });

  it("colours it with the brand rather than a darker grey", () => {
    // Two greys was the old answer, and at arm's length it was no answer.
    expect(src).toMatch(/color=\{focused \? c\.primary : c\.textMuted\}/);
    expect(src).toMatch(/color: focused \? c\.primary : c\.textMuted/);
  });

  it("hands the icons the colour behind them", () => {
    expect(src).toMatch(/knockout=\{c\.surface\}/);
  });

  it("keeps the basket solid whatever tab you are on", () => {
    // It is a button, not a tab marker — an outline basket that fills only
    // when you are already looking at the basket is backwards.
    const cart = src.slice(src.indexOf("if (isCart)"), src.indexOf("if (!item)"));
    expect(cart).toMatch(/<CartGlyph[^>]*\bfilled\b/);
  });

  it("shows the basket as selected without changing its size", () => {
    // THE RULE THREE VERSIONS OF THIS BAR COST: nothing in it may change
    // size. The selected state is the halo's opacity and nothing else.
    const cart = src.slice(src.indexOf("if (isCart)"), src.indexOf("if (!item)"));
    expect(cart).toMatch(/opacity: focused \? [\d.]+ : [\d.]+/);
    expect(cart).not.toMatch(/(width|height): focused \?/);
  });

  it("still counts the basket against the disc, not the slot", () => {
    // Anchored to the slot, the badge measured from a fifth of the bar's width
    // away from a 44-point button and floated in open space beside it.
    const styles = src.slice(src.indexOf("const styles = StyleSheet.create"));
    const badge = styles.slice(styles.indexOf("badge: {"));
    expect(badge).toMatch(/position: "absolute"/);
    expect(src).toMatch(/<View style=\{styles\.discWrap\}>[\s\S]*?styles\.badge/);
  });

  it("names the first tab after the screen it opens", () => {
    // It was "Food", with a crossed-utensils glyph, opening the marketplace
    // home — a first tab named after one of the shortcuts inside it.
    expect(src).toMatch(/FoodTab: \{ route: "FoodTab", label: "Home", icon: HomeGlyph \}/);
  });
});
