import { describe, expect, it } from "vitest";

/**
 * EVERY LIST'S EMPTY STATE KNOWS WHICH QUERY IT IS THE EMPTY STATE OF.
 *
 * `rows.length === 0` is how a list gets to its empty cell, and rows are
 * `data ?? []` — so two dozen screens drew "No customers yet" over a request
 * that had been refused or had failed. <TableEmpty> answers for all three
 * now, but only when it is told the query (`from`). This is what stops the
 * twenty-fifth list from leaving it out.
 *
 * A cell that is not an empty state at all — "Loading…" — is the one
 * exception, and is recognised by saying exactly that.
 */
const SCREENS = import.meta.glob("../../../modules/**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

interface Cell {
  file: string;
  tag: string;
  inside: string;
  /** The query the rows above this cell wait on — `x` in the nearest `x.isLoading ?` before it, if there is one. */
  waitsOn: string | null;
}

function cells(): Cell[] {
  const out: Cell[] = [];

  for (const [file, source] of Object.entries(SCREENS)) {
    if (file.includes(".test.")) continue;
    let at = source.indexOf("<TableEmpty");

    while (at !== -1) {
      // The opening tag ends at the first ">" that is not inside a `{…}`.
      let depth = 0;
      let end = at;
      for (; end < source.length; end++) {
        const ch = source[end];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ">" && depth === 0) break;
      }
      const close = source.indexOf("</TableEmpty>", end);
      const waits = [...source.slice(Math.max(0, at - 1500), at).matchAll(/(\w+)\.isLoading \?/g)].pop();
      out.push({
        file: file.split("/modules/")[1],
        tag: source.slice(at, end + 1),
        inside: source.slice(end + 1, close).trim(),
        waitsOn: waits ? waits[1] : null,
      });
      at = source.indexOf("<TableEmpty", close);
    }
  }

  return out;
}

describe("a list's empty state is told which query it is the empty state of", () => {
  const found = cells();

  it("is looking at the lists there are", () => {
    // Twenty-eight when this was written. Fewer than twenty means the glob
    // or the parser has gone blind, not that the lists went away.
    expect(found.length).toBeGreaterThanOrEqual(20);
    expect(new Set(found.map((c) => c.file)).size).toBeGreaterThanOrEqual(18);
  });

  it("reads an opening tag whole, braces and all", () => {
    const withBraces = found.find((c) => /colSpan=\{[^}]*\?/.test(c.tag));

    expect(withBraces, "no cell with a conditional colSpan was found — the parser is not being exercised").toBeDefined();
    expect(withBraces!.tag.endsWith(">")).toBe(true);
    expect(withBraces!.tag).toContain("className=");
  });

  it("every one of them passes the query — or is only saying Loading…", () => {
    const untold = found.filter((c) => !/\bfrom=\{/.test(c.tag) && c.inside !== "Loading…").map((c) => `${c.file}: ${c.inside.slice(0, 40)}`);

    expect(untold, "these empty states will say 'nothing here' over a refused or failed request").toEqual([]);
  });

  it("the query it is told is the one its own table waits on", () => {
    // A cell handed its neighbour's query type-checks, and would report the
    // neighbour's failure — or stay silent about its own.
    const waiting = found.filter((c) => c.waitsOn !== null && /\bfrom=\{/.test(c.tag));
    const wrong = waiting
      .filter((c) => c.tag.match(/\bfrom=\{(\w+)\}/)?.[1] !== c.waitsOn)
      .map((c) => `${c.file}: waits on ${c.waitsOn}, told ${c.tag.match(/\bfrom=\{(\w+)\}/)?.[1]}`);

    // Most tables are written `x.isLoading ? … : rows.length === 0 ? <TableEmpty>`.
    expect(waiting.length, "almost no table could be checked — the pattern this looks for has changed").toBeGreaterThanOrEqual(15);
    expect(wrong).toEqual([]);
  });

  it("and says what it was fetching, so the sentence is about this list", () => {
    const unnamed = found.filter((c) => /\bfrom=\{/.test(c.tag) && !/\bwhat=/.test(c.tag)).map((c) => c.file);

    expect(unnamed, "these would say 'This list could not be loaded'").toEqual([]);
  });
});
