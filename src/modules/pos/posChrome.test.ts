import { describe, expect, it } from "vitest";

/**
 * The till's two bars, at the width a shop actually holds it.
 *
 * This exact mistake was reported twice, from a photograph both times.
 *
 * The top bar and the bottom bar were each `overflow-x-auto no-scrollbar` with
 * BOTH of their groups marked `shrink-0`. Nothing could give, so the row
 * overflowed — and the scrollbar was hidden, so nothing on screen said it had.
 * At 768px the top bar pushed **Drawer** and **Close shift** off the right
 * edge, and the bottom bar pushed the wordmark and the connection pill off the
 * left. All four still existed. None of them could be seen or reached.
 *
 * Hiding a scrollbar on a row of CHIPS is fine — a half-cut chip is its own
 * cue. Hiding it on a row of BUTTONS is a control that silently is not there.
 *
 * Reads source text rather than rendering — a lint rule wearing a test's
 * clothes. Uses import.meta.glob rather than node:fs so it typechecks under
 * the app's browser tsconfig, which has no Node types.
 */

const SOURCE = Object.entries(
  import.meta.glob("./pages/PosPage.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
)[0]?.[1];

/** The class list of the element wrapping a marker comment's next `<div`. */
const barAfter = (marker: string): string => {
  const at = SOURCE.indexOf(marker);
  if (at === -1) throw new Error(`"${marker}" not found — did the bar move?`);
  const div = SOURCE.indexOf("<div className=", at);

  return SOURCE.slice(div).match(/className="([^"]*)"/)?.[1] ?? "";
};

describe("the till's chrome gives way rather than disappearing", () => {
  it("has the file to read", () => {
    expect(SOURCE).toBeDefined();
  });

  it.each([
    ["top", "{/* Full-bleed workspace."],
    ["bottom", "{/* The same mistake the top bar had"],
  ])("the %s bar never hides its own overflow", (_which, marker) => {
    // Finding the bar by the comment that PRECEDES the next one, so the
    // assertion moves with the file rather than a line number.
    const before = SOURCE.slice(0, SOURCE.indexOf(marker));
    const bar = before.slice(before.lastIndexOf("<div className="));

    expect(bar).not.toMatch(/no-scrollbar[^"]*overflow-x-auto|overflow-x-auto[^"]*no-scrollbar/);
  });

  it("the bottom bar wraps instead of running off the edge", () => {
    expect(barAfter("{/* The same mistake the top bar had")).toMatch(/\bflex-wrap\b/);
  });

  it("promises no key a tablet cannot press", () => {
    // F4 / F6 / F7 / F9 hints. A hint for a key that does not exist on the
    // device is a broken promise printed on the screen.
    const shown = SOURCE.match(/<kbd className="(?!hidden)[^"]*">\s*F\d/g) ?? [];

    expect(shown).toEqual([]);
  });
});
