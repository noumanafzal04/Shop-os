import { describe, expect, it } from "vitest";

/**
 * THE PAGE NEVER SCROLLS SIDEWAYS BECAUSE OF ONE WIDE TABLE.
 *
 * The app shell is a flex row from `xl` up, and its content column was a plain
 * `flex-1`. A flex child's default `min-width: auto` refuses to shrink below
 * its own content — so a single table wider than the window pushed the WHOLE
 * shell past the right edge, header and all, and the page scrolled sideways.
 *
 * Two things made it survive for as long as it did:
 *
 *   · a sideways-scrolling page has no visible scrollbar, so the only symptom
 *     is that the last column of the table is not there;
 *   · it only ever appeared at `xl` and up, because below that the same markup
 *     is a block and behaves. The WIDEST screens were the broken ones, which is
 *     the opposite of where anybody looks for a layout bug.
 *
 * Found by a browser — jsdom has no layout engine and could never have seen it.
 * Guarded here anyway, because this is a one-word regression in a file nobody
 * edits for layout reasons, and a unit test fails in seconds on the machine of
 * whoever removes it.
 */

const SOURCES = import.meta.glob("./*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const layout = (): string => {
  const found = Object.entries(SOURCES).find(([path]) => path.endsWith("AppLayout.tsx"));
  if (!found) throw new Error("AppLayout.tsx is no longer where this guard reads it");

  return found[1];
};

describe("the app shell", () => {
  it("reads its own source, so a silent pass cannot look like a clean one", () => {
    // The denominator. Without it, a glob that stopped matching would make
    // every assertion below vacuous.
    expect(layout().length).toBeGreaterThan(500);
    expect(layout()).toContain("flex-1");
  });

  it("lets its content column shrink below the width of what is inside it", () => {
    // `flex-1` on its own is `flex: 1 1 0%` PLUS an implicit `min-width: auto`,
    // and the second half is the one that widens the page.
    const column = /className=\{`([^`]*\bflex-1\b[^`]*)`/.exec(layout())?.[1];

    expect(column, "the shell's content column is no longer a template literal").toBeDefined();
    expect(column).toMatch(/\bmin-w-0\b/);
  });

  it("still becomes a flex row only at xl, which is where this can bite", () => {
    // If the shell ever went flex at every width, the same defect would reach
    // phones and tablets too and this guard would need to widen with it.
    expect(layout()).toContain("xl:flex");
  });
});
