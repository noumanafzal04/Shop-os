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

describe("one door to dine-in, not two", () => {
  it("the till does not offer its own table when the shop has a floor", () => {
    // A shop with the `dine_in` module has real tables, running tabs, a kitchen
    // board and split bills on the Floor screen, all keyed to a
    // `dining_table_id`. The till's own control writes a free-text `table_no`
    // onto the sale and nothing else: no tab, no KOT, and the floor never
    // learns the table is occupied. A waiter who reached for it would leave the
    // kitchen with nothing to cook.
    //
    // "5", "Table 5" and "T5" are also three different tables there, none of
    // which is the one the shop actually named 5.
    //
    // The gate was the TRADE, so both doors stood open for every food shop.
    // It is now the trade AND the absence of a floor — a juice corner or a
    // takeaway counter, for which a typed number is genuinely all there is.
    expect(SOURCE).toMatch(/isRestaurant && !has\("dine_in"\)/);
    expect(SOURCE).not.toMatch(/\{isRestaurant && \(\s*\n\s*<div className="flex items-center gap-2 border-b/);
  });
});

