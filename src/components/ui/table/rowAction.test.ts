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

/** The hand-rolled shapes this sweep replaced, and any near relative. */
const BY_HAND = /className="text-(?:gray-500 hover:text-gray-700|error-500 hover:text-error-600)/;

const offenders = (): string[] =>
  Object.entries(SOURCES)
    .filter(([, src]) => BY_HAND.test(src))
    .map(([path]) => path.replace(/^.*\/modules\//, ""));

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

  it("no screen still writes one by hand", () => {
    expect(offenders()).toEqual([]);
  });
});
