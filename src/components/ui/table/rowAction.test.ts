import { describe, expect, it } from "vitest";

import { ROW_ACTION, ROW_ACTION_DANGER } from "./rowAction";

/**
 * The only thing you can DO on a list page is not drawn as a caption.
 *
 * Twenty-seven row actions were hand-written across twenty files as bare
 * coloured text — no shape, no hover surface, no pressed state. That is most of
 * why a shop reported these screens as looking blank: a page of white rows
 * whose only controls look like labels.
 *
 * The half that is not cosmetic: a line of text is a ~17px tap target. These
 * screens are held on phones and tablets, the row underneath is usually
 * clickable itself, and Edit sits directly beside Delete. Missing Delete and
 * opening the record costs nothing. Missing Edit and hitting Delete does.
 *
 * Reads source text rather than rendering — a lint rule wearing a test's
 * clothes; it proves the shared class was asked for, not that the pill looks
 * right. Uses import.meta.glob rather than node:fs so it typechecks under the
 * app's browser tsconfig, which has no Node types.
 */

const SOURCES = import.meta.glob("../../../modules/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * A control inside a table cell that is drawn as coloured text.
 *
 * ── Why the first detector could only find what was already fixed ───────
 *
 * It was two literal class strings:
 *
 *     /className="text-(?:gray-500 hover:text-gray-700|error-500 hover:text-error-600)/
 *
 * — the exact two shapes the original sweep had replaced. Every other spelling
 * of the same mistake walked straight past it: `text-brand-500
 * hover:text-brand-600`, `mr-3 text-success-500 …`, `text-theme-xs
 * text-error-500 …`. **Seventeen were sitting in table cells when this was
 * rewritten**, including rows where Delete had been swept and the Edit beside it
 * had not — which is worse than neither, because the pair no longer reads as a
 * pair.
 *
 * A detector that recognises the instances somebody already found is not a
 * rule. It is a record of one afternoon.
 *
 * ── What it looks for now ───────────────────────────────────────────────
 *
 * Any `<button>` inside a `<td>` whose className is a literal with no height,
 * no padding and no size — i.e. a tap target the height of the font. Scoping it
 * to table cells is what keeps it honest: a button in a sentence ("Change
 * register", "Didn't print") is legitimately a text link, and a rule that
 * flagged those would be argued with until it was deleted.
 */
const SIZED = /\b(?:min-h-|h-\d|h-\[|py-|p-\d|p-\[|size-)/;

const offenders = (): string[] => {
  const found: string[] = [];

  for (const [path, src] of Object.entries(SOURCES)) {
    for (const cell of src.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)) {
      for (const button of cell[1].matchAll(/<button\b([^>]*)>/g)) {
        const attrs = button[1];
        if (attrs.includes("ROW_ACTION")) continue;

        const className = /className="([^"]*)"/.exec(attrs)?.[1];
        if (className === undefined || className === "" || SIZED.test(className)) continue;

        found.push(`${path.replace(/^.*\/modules\//, "")} → ${className}`);
      }
    }
  }

  return found;
};

describe("a row action looks like something you can press", () => {
  it("scans the modules at all, so a silent zero cannot pass as a clean sweep", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
  });

  it("is a padded target, not a line of text", () => {
    // ~36px with a surface under it, rather than the height of the font.
    for (const cls of [ROW_ACTION, ROW_ACTION_DANGER]) {
      expect(cls).toMatch(/\bmin-h-9\b/);
      expect(cls).toMatch(/\bpx-2\.5\b/);
      expect(cls).toMatch(/hover:bg-/);
    }
  });

  it("says which of the two takes something away", () => {
    // Edit and Delete sit side by side. If they read the same, the row is a
    // coin toss.
    expect(ROW_ACTION).toMatch(/text-gray-/);
    expect(ROW_ACTION_DANGER).toMatch(/text-error-/);
    expect(ROW_ACTION).not.toEqual(ROW_ACTION_DANGER);
  });

  it("is not filled until a finger is on it", () => {
    // Same reasoning as Button's `danger`: a column of red slabs reads as an
    // emergency, and then the one real warning on the page means nothing. The
    // tint belongs to hover — at rest the row stays a row.
    const atRest = ROW_ACTION_DANGER.split(" ").filter((c) => !c.includes("hover:"));

    expect(atRest.filter((c) => c.includes("bg-"))).toEqual([]);
    // …and it does have the hover tint, so this is a real constraint rather
    // than an assertion that passes on an empty string.
    expect(ROW_ACTION_DANGER).toMatch(/hover:bg-error-/);
  });

  it("finds table cells at all, so a silent zero cannot pass as a clean sweep", () => {
    // The denominator for the detector itself. If the `<td>` match ever breaks,
    // this fails instead of the sweep silently passing on nothing.
    const cells = Object.values(SOURCES).reduce(
      (n, src) => n + [...src.matchAll(/<td\b[^>]*>/g)].length,
      0,
    );

    expect(cells).toBeGreaterThan(150);
  });

  it("no screen still writes one by hand", () => {
    expect(offenders()).toEqual([]);
  });

  it("never leaves half a pair", () => {
    // The worst version of this defect, and the one that survives every sweep:
    // Delete gets the shared class and the Edit beside it does not. Two
    // controls that do different things now LOOK different in kind — one reads
    // as a button and the other as a caption — so the eye stops treating them
    // as a set, and the pair exists precisely so a finger can tell them apart.
    //
    // Detected by adjacency rather than by container, which is what makes it
    // work outside a table: a text link in a sentence never sits next to a
    // ROW_ACTION button, so prose cannot trip it.
    const halves: string[] = [];

    for (const [path, src] of Object.entries(SOURCES)) {
      const buttons = [...src.matchAll(/<button\b([^>]*)>/g)];

      buttons.forEach((button, i) => {
        const attrs = button[1];
        if (!attrs.includes("ROW_ACTION")) return;

        for (const neighbour of [buttons[i - 1], buttons[i + 1]]) {
          if (neighbour === undefined) continue;

          // SIBLINGS, not merely the next button along.
          //
          // The first version measured distance alone and immediately produced
          // a false pair: the till's "Gift receipt" row and the "Didn't print"
          // link in the sentence above it are 300 characters apart and in
          // different containers. A closing block tag between two buttons means
          // they are not a pair, whatever the byte count says.
          const from = Math.min(button.index, neighbour.index);
          const between = src.slice(from, Math.max(button.index, neighbour.index));
          if (/<\/(?:div|p|section|li|td)>/.test(between)) continue;

          const className = /className="([^"]*)"/.exec(neighbour[1])?.[1];
          if (className === undefined || className === "" || SIZED.test(className)) continue;

          halves.push(`${path.replace(/^.*\/modules\//, "")} → ${className}`);
        }
      });
    }

    expect([...new Set(halves)]).toEqual([]);
  });
});
