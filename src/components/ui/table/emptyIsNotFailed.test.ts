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

/**
 * AND THE LISTS THAT ARE NOT TABLES.
 *
 * Cards, tiles, panels, the list inside a dialog: about sixty of them, and
 * every one written the same way —
 *
 *     {riders.isLoading ? (
 *       <Skeleton />
 *     ) : rows.length === 0 ? (
 *       <p>No riders yet.</p>        ← drawn for a refusal and a failure too
 *     ) : (
 *
 * That shape is what this looks for: a branch asking whether the rows are
 * none, under a branch that waited on a query. Its first line must be
 * <ListEmpty> (or, in a table, lead to <TableEmpty>) — or the place is named
 * below with the reason it is not a list's empty state.
 */
const ASKS_IF_EMPTY = /^(\s*)\) : (!?[\w.?()[\]! &|=]*?)\.length === 0( && [\w.]+\.length === 0)? \? \($/;
const WAITS_ON = /(\w+)\.(?:isLoading|isPending) \?|\{(isLoading) \?|\b(loading) \?/;

/** `file#rows` → why this is not a list saying "nothing" over a request that went wrong. */
const NOT_A_LISTS_EMPTY_STATE: Record<string, string> = {
  "catalog/pages/LabelsPage.tsx#parts": "one product's own printable parts, inside a row of a list that did load",
};

interface Branch {
  file: string;
  rows: string;
  waitsOn: string;
  /** The three lines the empty branch opens with — comments about it aside. */
  opens: string;
}

function branches(): Branch[] {
  const out: Branch[] = [];

  for (const [file, source] of Object.entries(SCREENS)) {
    if (file.includes(".test.")) continue;
    const lines = source.split("\n");

    lines.forEach((line, at) => {
      const asks = line.match(ASKS_IF_EMPTY);
      if (!asks) return;

      let waitsOn: string | null = null;
      for (let up = at - 1; up >= Math.max(0, at - 60) && waitsOn === null; up--) {
        const waits = lines[up].match(WAITS_ON);
        if (waits) waitsOn = waits[1] ?? waits[2] ?? waits[3];
      }
      if (waitsOn === null) return;

      const opens = lines.slice(at + 1, at + 40).filter((l) => !l.trim().startsWith("//")).slice(0, 3).join(" ");
      out.push({ file: file.split("/modules/")[1], rows: asks[2], waitsOn, opens });
    });
  }

  return out;
}

describe("a list that waits on a query and then asks whether it is empty", () => {
  const found = branches();
  const key = (b: Branch) => `${b.file}#${b.rows}`;

  it("is looking at the lists there are", () => {
    // Eighty-odd when this was written, tables included.
    expect(found.length).toBeGreaterThanOrEqual(60);
  });

  it("says which nothing it is — through <ListEmpty>, or <TableEmpty> in a table", () => {
    const silent = found
      .filter((b) => !/<(ListEmpty|TableEmpty)\b/.test(b.opens) && !(key(b) in NOT_A_LISTS_EMPTY_STATE))
      .map((b) => `${key(b)} (waits on ${b.waitsOn})`);

    expect(silent, "these will say there is nothing over a request that was refused or failed").toEqual([]);
  });

  it("is told the query it waited on", () => {
    const told = (b: Branch) => b.opens.match(/<(?:ListEmpty|TableEmpty) from=\{(\w+)\}/)?.[1];
    // Where the wait is on a bare `isLoading` or a `loading` prop, the query has another name; nothing to compare.
    const named = found.filter((b) => told(b) !== undefined && b.waitsOn !== "isLoading" && b.waitsOn !== "loading");
    const wrong = named.filter((b) => told(b) !== b.waitsOn).map((b) => `${key(b)}: waits on ${b.waitsOn}, told ${told(b)}`);

    expect(named.length).toBeGreaterThanOrEqual(40);
    expect(wrong).toEqual([]);
  });

  it("every exemption is still a real place — none outlives the code it excused", () => {
    const stale = Object.keys(NOT_A_LISTS_EMPTY_STATE).filter((k) => !found.some((b) => key(b) === k));

    expect(stale).toEqual([]);
  });
});

