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
    // F2 / F4 / F6 / F7 / F9 hints. A hint for a key that does not exist on the
    // device is a broken promise printed on the screen.
    //
    // The first version of this rule only checked that the class did not START
    // with something other than `hidden`, and a `hidden … sm:inline` hint sailed
    // through it — hidden on a phone, back on every tablet from 640px up. The
    // rule was passing while blind to its own subject.
    //
    // So it now asks the question that actually matters: a key hint must be
    // hidden, and whatever un-hides it must be `xl` — the width at which this
    // codebase says "a real counter machine with a real keyboard"
    // (RAIL_STARTS_COLLAPSED_BELOW = 1280). `sm`, `md` and `lg` are all tablets.
    const hints = SOURCE.match(/<kbd className="[^"]*">\s*F\d/g) ?? [];

    expect(hints.length, "no key hints found at all — has the markup moved?")
      .toBeGreaterThan(0);

    for (const hint of hints) {
      const cls = hint.match(/className="([^"]*)"/)?.[1] ?? "";
      expect(cls, hint).toMatch(/\bhidden\b/);
      expect(cls, hint).not.toMatch(/\b(sm|md|lg):(inline|block|flex)\b/);
    }
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

  it("but the remaining door is signposted from the till", () => {
    // Closing a door without pointing at the other one is worse than leaving
    // both open. The POS runs FULL SCREEN with no sidebar and exactly one exit
    // (/tenant), so once the till stopped offering a table, a waiter who needed
    // one had to leave the till, cross the dashboard and find the Floor —
    // during service, holding a tray.
    //
    // So the same condition that closes the till's own control must open a link
    // to the real one. This is the pairing, not two independent facts:
    // `has("dine_in")` hides the toggle AND shows the way.
    const link = SOURCE.match(/\{isRestaurant && has\("dine_in"\) && \([\s\S]{0,600}?\)\}/)?.[0] ?? "";

    expect(link, "no dine_in-gated block in the POS header").not.toBe("");
    expect(link).toContain('to="/tenant/dine-in"');
  });
});

describe("the tile grid fits the pane it lives in", () => {
  it("goes four across from the tablet up, not three all the way to a monitor", () => {
    // The catalog pane is `lg:col-span-6 xl:col-span-5` — it NARROWS as the
    // viewport widens, so it is roughly the same ~500px from a tablet landscape
    // to a shop monitor. A column count that keeps climbing with the viewport
    // is answering the wrong question: the tile grid is sized by the PANE, not
    // by the screen.
    //
    // It was `sm:grid-cols-3 2xl:grid-cols-4`, so a tablet got three tiles in a
    // pane that fits four, and the shop reported the card view as looking wrong
    // on a tablet.
    const grid = SOURCE.match(/<div className="grid grid-cols-2[^"]*"/)?.[0] ?? "";

    expect(grid, "no tile grid found").not.toBe("");
    expect(grid).toContain("lg:grid-cols-4");
  });

  it("the skeleton is the height of the tile it stands in for", () => {
    // A placeholder that is taller than the thing it becomes makes the grid
    // jump the moment products arrive — under a cashier's finger.
    const skeleton = SOURCE.match(/animate-pulse rounded-xl bg-white\/\[0\.16\][^"]*/)?.[0] ?? "";
    const image = SOURCE.match(/relative h-\d+ w-full bg-black\/25[^"]*/)?.[0] ?? "";

    expect(skeleton, "no tile skeleton").not.toBe("");
    // Both step at the same breakpoint, so the two never disagree about size.
    expect(skeleton).toContain("xl:h-");
    expect(image).toContain("xl:h-");
  });
});
