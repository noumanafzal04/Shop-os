import { describe, expect, it } from "vitest";

/**
 * The app measures the viewport that exists, not the one it wishes it had.
 *
 * `vh` is the LARGE viewport: the height the page would have if the browser's
 * address bar were hidden. On a phone or a tablet it is not hidden. So
 * `max-h-[85vh]` on a panel is closer to 100% of the actual glass, and with an
 * overlay's own padding around it the part that ends up past the bottom edge
 * is whatever sits last — which, in a form, is the footer holding Save.
 *
 * This was reported twice from one shop before it was understood as one bug:
 *
 *   · The Appearance canvas was `h-screen` (= 100vh) and a flex column ending
 *     in Reset and Save. The merchant could change every colour in the shop
 *     and had no Save to press. Nothing scrolled to rescue it — the middle
 *     band is the only scroller, by design.
 *   · `ModalForm` — the component EVERY long form in the app is built on —
 *     capped at `85vh` with the same three-band shape. Same bug, fifteen more
 *     places to appear, none of them reported yet.
 *
 * `dvh` is the height that actually exists right now. It is the unit the whole
 * app uses, and the rule below is what keeps `vh` from creeping back in one
 * modal at a time.
 *
 * Reads source text rather than rendering — a lint rule wearing a test's
 * clothes. Uses import.meta.glob rather than node:fs so it typechecks under
 * the app's browser tsconfig, which has no Node types.
 */

const SOURCES = {
  ...(import.meta.glob("../../../modules/**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob("../../../components/**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob("../../../layout/**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
};

/**
 * `[85vh]`, `h-screen` — both mean the large viewport.
 *
 * `min-h-screen` is deliberately NOT caught: it is a floor on a page that may
 * grow and scroll, not a ceiling on a panel that must fit. Nothing is hidden
 * by a page being taller than the glass.
 */
const LARGE_VIEWPORT = /\[\d+vh\]|(?<!min-)\bh-screen\b/;

/**
 * Comments out, code in — a file that EXPLAINS why it stopped using `h-screen`
 * has to be allowed to say the word. `//` counts only at the start of a line,
 * so the `xmlns="http://…"` on every inline SVG keeps its className company.
 */
const stripComments = (src: string): string =>
  src
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

const offenders = (): string[] =>
  Object.entries(SOURCES)
    .filter(([, src]) => LARGE_VIEWPORT.test(stripComments(src)))
    .map(([path]) => path.replace(/^.*\/src\//, "").replace(/^(\.\.\/)+/, ""));

describe("a panel measures the glass it is actually on", () => {
  it("scans the app at all, so a silent zero cannot pass as a clean sweep", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
  });

  it("catches both spellings of the mistake", () => {
    // Proves the pattern bites rather than trusting an empty result.
    expect(LARGE_VIEWPORT.test('className="max-h-[85vh] flex-col"')).toBe(true);
    expect(LARGE_VIEWPORT.test('className="flex h-screen flex-col"')).toBe(true);
    // …and does not catch the two that are fine.
    expect(LARGE_VIEWPORT.test('className="max-h-[85dvh]"')).toBe(false);
    expect(LARGE_VIEWPORT.test('className="min-h-screen bg-gray-50"')).toBe(false);
  });

  it("no panel is capped against a viewport the device does not have", () => {
    expect(offenders()).toEqual([]);
  });
});
