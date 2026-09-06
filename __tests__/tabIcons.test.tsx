import React from "react";
import ReactTestRenderer from "react-test-renderer";
import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";
import {
  BasketIcon,
  CartIcon,
  HomeIcon,
  ParcelIcon,
  PersonIcon,
  ReceiptIcon,
  WalletIcon,
} from "../src/common/ui/icons";

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
  HomeIcon,
  BasketIcon,
  CartIcon,
  ReceiptIcon,
  PersonIcon,
  ParcelIcon,
  WalletIcon,
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

  it.each(names)("%s draws a different shape in each weight", (name) => {
    const Glyph = GLYPHS[name];

    const outline = render(<Glyph size={22} color="#111111" />);
    const filled = render(<Glyph size={22} color="#E94E00" bold />);

    const paths = (all: any[]) => all.filter((n) => n.type === "Path");

    // Something was actually drawn. A component that returns an empty <Svg/>
    // passes every colour assertion ever written about it.
    expect(paths(outline)).toHaveLength(1);
    expect(paths(filled)).toHaveLength(1);

    // ── The rule, stated the way the drawings actually work ───────────
    //
    // Twice now this file has encoded a MECHANISM rather than the rule. First
    // "the outline is stroked and the solid is filled", which was true only of
    // seven glyphs drawn by hand. Then "one state is Phosphor's fill weight",
    // which lasted until the fills were seen on a phone: at 22 points a solid
    // house is a pentagon and a solid basket is a bucket, and the interior is
    // exactly the part that made each icon recognisable.
    //
    // What has been the rule the whole time, through both: the two states are
    // DIFFERENT DRAWINGS of the same thing, each painted in the colour it was
    // given. Regular and bold, both of them hollow.
    expect(paths(outline)[0].props.d).not.toBe(paths(filled)[0].props.d);
    expect(paths(outline)[0].props.fill).toBe("#111111");
    expect(paths(filled)[0].props.fill).toBe("#E94E00");
  });

  it.each(names)("%s stays hollow in BOTH weights", (name) => {
    const Glyph = GLYPHS[name];
    const d = (bold: boolean) =>
      render(<Glyph size={22} color="#111111" bold={bold} />)
        .filter((n) => n.type === "Path")[0].props.d as string;

    // "filled icons ni achy lgaye." The selected state is a heavier LINE, not
    // a silhouette — so the interior that makes a house a house and a basket a
    // basket survives being selected.
    //
    // A shape with a hole in it needs a SECOND subpath to say where the hole
    // is; a solid silhouette is one. That is what makes this a real detector
    // rather than a proxy: paste Phosphor's `fill` weight into either slot —
    // a one-word edit in the generator — and `house-fill` drops from two
    // subpaths to one, here, rather than on somebody's phone.
    for (const bold of [false, true]) {
      expect((d(bold).match(/[Mm]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    }
    expect(d(true)).not.toBe(d(false));
  });

  it("takes the lighter weight for the tab you are NOT on", () => {
    // Neither path length nor subpath count can tell two weights of one
    // drawing apart — they are the same shape at a different stroke, so the
    // numbers move in whichever direction the coordinates happen to. The
    // declaration in the generator is the only honest place to check it, and
    // swapping the pair is exactly the one-word mistake worth catching: the
    // tab you are on would become the faintest thing in the bar.
    const gen = fs.readFileSync(path.join(PROJECT_ROOT, "scripts/build-icons.mjs"), "utf8");
    const pair = /const WEIGHTS = \{ off: "(\w+)", on: "(\w+)" \}/.exec(gen);

    expect(pair).not.toBeNull();

    // Phosphor's own order, lightest first.
    const ORDER = ["thin", "light", "regular", "bold"];
    expect(ORDER).toContain(pair![1]);
    expect(ORDER).toContain(pair![2]);
    expect(ORDER.indexOf(pair![1])).toBeLessThan(ORDER.indexOf(pair![2]));

    // And never the solid one, in either slot. See the hollowness test above.
    expect(gen).not.toMatch(/WEIGHTS = \{[^}]*"fill"/);
  });

  it("takes the size it is given, on the grid its drawings use", () => {
    const svg = render(<HomeIcon size={30} color="#111111" />).find(
      (n) => n.type === "Svg",
    );
    expect(svg?.props.width).toBe(30);
    expect(svg?.props.height).toBe(30);
    // 256, not 24: Phosphor's own grid, kept rather than rescaled so every
    // path can be diffed against the file it was copied from. A
    // hand-converted path is a drawing nobody can check.
    expect(svg?.props.viewBox).toBe("0 0 256 256");
  });

  it("carries the licence of the drawings it copied in", () => {
    // The drawings are imported and the code is not, so there is no dependency
    // to point at — the attribution has to live somewhere a person will find.
    const icons = fs.readFileSync(
      path.join(PROJECT_ROOT, "src/common/ui/icons/index.tsx"), "utf8",
    );
    expect(icons).toMatch(/MIT licensed, copied from/);
    expect(fs.readFileSync(path.join(PROJECT_ROOT, "LICENSE-icons.md"), "utf8"))
      .toMatch(/MIT License[\s\S]*Copyright \(c\) 2023 Phosphor Icons/);
  });
});

describe("one family, and no way back to two", () => {
  const files = sourceFiles(path.join(PROJECT_ROOT, "src"));

  it("scanned the app", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("has no second icon library anywhere", () => {
    // For a while this app had both: Phosphor on the bar, the menus and the
    // trade tiles, lucide everywhere else — which put two families on the home
    // screen, tiles in one and the header above them in the other. Two
    // coherent sets mixed is worse than either alone.
    const offenders = files
      .filter((f) => /from ["']lucide-react-native["']/.test(fs.readFileSync(f, "utf8")))
      .map((f) => `  ${path.relative(PROJECT_ROOT, f)}`);

    expect(offenders.join("\n")).toBe("");
  });

  it("does not ship the package it stopped using", () => {
    // A dependency nothing imports is still downloaded, still installed, and
    // still the first thing the next person reaches for.
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("lucide-react-native");
  });

  it("keeps the drawings reproducible", () => {
    // The alternative to a dependency is a file full of numbers nobody can
    // check. The generator is what makes them checkable: it pins the version,
    // names the source file for every glyph, and refuses anything that is not
    // a single stroke-free path on the expected grid.
    const gen = fs.readFileSync(path.join(PROJECT_ROOT, "scripts/build-icons.mjs"), "utf8");
    expect(gen).toMatch(/const VERSION = "\d+\.\d+\.\d+"/);
    expect(gen).toMatch(/unexpected viewBox/);
    expect(gen).toMatch(/paths\.length !== 1/);
    expect(gen).toMatch(/has a stroke; this set is fills only/);
    // …and that both weights of an icon are genuinely different drawings.
    expect(gen).toMatch(/both weights identical/);
  });
});

describe("the bar wires the two states up", () => {
  const src = fs
    .readFileSync(path.join(PROJECT_ROOT, "src/navigation/AppTabBar.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("weights the icon of the tab you are on", () => {
    expect(src).toMatch(/bold=\{focused\}/);
    // Never the solid weight. See the hollowness test above.
    expect(src).not.toMatch(/filled=/);
  });

  it("colours it with the brand rather than a darker grey", () => {
    // Two greys was the old answer, and at arm's length it was no answer.
    expect(src).toMatch(/color=\{focused \? c\.primary : c\.textMuted\}/);
    expect(src).toMatch(/color: focused \? c\.primary : c\.textMuted/);
  });

  it("gives the icons nothing but a size, a colour and a weight", () => {
    // `knockout` is gone. It existed because a hand-drawn solid glyph needed
    // its interior lines repainted in the bar's own colour or it became a
    // blob; a designed silhouette does not, and a prop nothing reads is the
    // next person's wrong assumption.
    expect(src).not.toMatch(/knockout/);
    expect(src).toMatch(
      /<Icon size=\{23\} bold=\{focused\} color=\{focused \? c\.primary : c\.textMuted\} \/>/,
    );
  });

  it("keeps the basket solid whatever tab you are on", () => {
    // It is a button, not a tab marker — an outline basket that fills only
    // when you are already looking at the basket is backwards.
    const cart = src.slice(src.indexOf("if (isCart)"), src.indexOf("if (!item)"));
    expect(cart).toMatch(/<CartIcon[^>]*\bbold\b/);
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
    expect(src).toMatch(/FoodTab: \{ route: "FoodTab", label: "Home", icon: HomeIcon \}/);
  });
});
