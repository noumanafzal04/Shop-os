import { describe, expect, it } from "vitest";

/**
 * A table that does not fit SCROLLS. It never gets shaved.
 *
 * The wrapper around most tables in this app was
 * `overflow-hidden rounded-2xl border …` — chosen for the rounded corners,
 * which is what `overflow-hidden` is genuinely good for. It also does the
 * other thing overflow-hidden does: anything wider than the box is cut off and
 * unreachable.
 *
 * On a desktop that never showed, because `w-full` tables squash to fit. It
 * shows the moment a column has a floor — a quantity box you have to hit with
 * a finger, a min-width, a long invoice number — and it shows on the narrow
 * pane a tablet gives you. A twelve-column purchase order in a 320px column
 * loses its right-hand end, and the screen says nothing at all about it.
 *
 * **Silently missing is the worst of the three options.** Scrolling is fine.
 * Squashed is ugly but honest. Clipped looks finished and is wrong.
 *
 * So: no `<table>` sits inside a wrapper that clips. Reads source text rather
 * than rendering — a lint rule wearing a test's clothes; it proves the wrapper
 * can scroll, never that the result is comfortable. Uses import.meta.glob
 * rather than node:fs so it typechecks under the app's browser tsconfig, which
 * has no Node types.
 */

const SOURCES = import.meta.glob("../../../modules/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The `<div className="…">` immediately enclosing each `<table`.
 *
 * Walks backwards from the table to the nearest opening `<div`, which is the
 * element whose overflow actually governs it. Good enough because every table
 * in this app is wrapped directly; a table nested deeper would simply not be
 * checked, which the count assertion below is there to notice.
 */
const wrappers = (): Array<{ file: string; cls: string }> => {
  const out: Array<{ file: string; cls: string }> = [];

  for (const [path, src] of Object.entries(SOURCES)) {
    const file = path.replace(/^.*\/modules\//, "");
    let from = 0;

    for (;;) {
      const at = src.indexOf("<table", from);
      if (at === -1) break;
      from = at + 6;

      const div = src.lastIndexOf("<div", at);
      if (div === -1) continue;
      const cls = src.slice(div, at).match(/className="([^"]*)"/)?.[1];
      if (cls) out.push({ file, cls });
    }
  }

  return out;
};

describe("a table that does not fit is reachable", () => {
  it("finds the tables at all, so a silent zero cannot pass as a clean sweep", () => {
    expect(wrappers().length).toBeGreaterThan(20);
  });

  it("none is wrapped in something that clips it", () => {
    const clipped = wrappers()
      .filter((w) => /\boverflow-hidden\b/.test(w.cls))
      .map((w) => w.file);

    expect([...new Set(clipped)]).toEqual([]);
  });
});
