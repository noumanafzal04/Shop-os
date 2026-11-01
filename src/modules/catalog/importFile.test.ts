import { describe, expect, it } from "vitest";

import {
  BYTE_ORDER_MARK,
  mergeSummaries,
  splitCsvText,
  categoryPaths,
  choicesForServer,
  failedRowsCsv,
  rowsToCorrect,
  startingChoices,
  undecided,
  type ImportSummary,
} from "./importFile";
import type { Category } from "./types";

const shelf = (id: string, name: string, children: Category[] = []): Category => ({
  id, name, parent_id: null, sort_order: 0, is_active: true, children,
});

describe("a shop's categories, as a sheet writes them", () => {
  it("a sub-category is its whole path", () => {
    const tree = [shelf("g", "Grocery", [shelf("b", "Beverages", [shelf("j", "Juices")])]), shelf("d", "Dairy")];

    expect(categoryPaths(tree)).toEqual([
      { id: "g", path: "Grocery" },
      { id: "b", path: "Grocery > Beverages" },
      { id: "j", path: "Grocery > Beverages > Juices" },
      { id: "d", path: "Dairy" },
    ]);
  });
});

describe("a category the shop does not have", () => {
  const unknown = [
    { name: "Bevrages", rows: 12, suggestion: { id: "b", path: "Grocery > Beverages" } },
    { name: "Imported Sweets", rows: 3, suggestion: null },
  ];

  it("a near-miss starts out pointed at the category it nearly was", () => {
    expect(startingChoices(unknown)).toEqual({ Bevrages: { action: "map", id: "b" } });
  });

  it("creating one is never where a choice starts", () => {
    // A default is pressed past, and that is how a spelling mistake becomes a shelf.
    expect(Object.values(startingChoices(unknown)).some((c) => c.action === "create")).toBe(false);
    expect(undecided(unknown, startingChoices(unknown))).toEqual(["Imported Sweets"]);
  });

  it("nothing is undecided once each has been answered", () => {
    expect(undecided(unknown, { Bevrages: { action: "skip" }, "Imported Sweets": { action: "create" } })).toEqual([]);
  });

  it("goes to the server as a list, with an id only where one was chosen", () => {
    expect(choicesForServer({ Bevrages: { action: "map", id: "b" }, "Imported Sweets": { action: "create" } })).toEqual([
      { name: "Bevrages", action: "map", id: "b" },
      { name: "Imported Sweets", action: "create" },
    ]);
  });
});

describe("the rows that did not go in, as a file", () => {
  const summary: Pick<ImportSummary, "headers" | "failed_rows"> = {
    headers: ["Name", "SKU", "Price"],
    failed_rows: [
      { row: 4, status: "failed", messages: ['Price "abc" is not a number.', "Price is missing."], cells: { Name: "Flour, 5kg", SKU: "FLR-1", Price: "abc" } },
      { row: 9, status: "waiting", messages: ["Its category is not in your shop yet."], cells: { Name: "Cola", SKU: "COLA" } },
    ],
  };

  it("keeps the file's own columns in its own order, and says what was wrong", () => {
    const [head, first, second] = failedRowsCsv(summary).replace(BYTE_ORDER_MARK, "").trim().split("\r\n");

    expect(head).toBe("Name,SKU,Price,_import_status,_error_message");
    // A comma in a name and quotes in a message must not move a column.
    expect(first).toBe('"Flour, 5kg",FLR-1,abc,failed,"Price ""abc"" is not a number. Price is missing."');
    // A cell the row never had is an empty cell, not a missing one.
    expect(second).toBe("Cola,COLA,,waiting,Its category is not in your shop yet.");
  });

  it("a row only waiting on a category is not handed back as a fault", () => {
    expect(rowsToCorrect(summary).failed_rows.map((r) => r.row)).toEqual([4]);
  });

  it("starts with the mark Excel needs to read Urdu", () => {
    expect(failedRowsCsv(summary).charCodeAt(0)).toBe(0xfeff);
  });
});

/**
 * #GS1 — a garments shop's 20,000 items were refused as one file ("more than
 * 500 rows") and had to be cut into forty by hand.
 */
describe("a long CSV goes in parts by itself", () => {
  const sheet = (rows: number) => ["Name,SKU,Price", ...Array.from({ length: rows }, (_, i) => `Item ${i + 1},S-${i + 1},${100 + i}`)].join("\n");

  it("a file that fits is sent as it is", () => {
    expect(splitCsvText(sheet(500))).toEqual([sheet(500)]);
  });

  it("20,000 rows become forty parts of 500, each with the heading row, and none is lost", () => {
    const parts = splitCsvText(sheet(20000));
    expect(parts).toHaveLength(40);
    for (const part of parts) expect(part.split("\n")[0]).toBe("Name,SKU,Price");
    expect(parts.map((p) => p.split("\n").length - 1)).toEqual(Array(40).fill(500));
    const last = parts[39].split("\n");
    expect(last[last.length - 1]).toBe("Item 20000,S-20000,20099");
  });

  it("a quoted cell holding a comma or a line break stays one row", () => {
    const text = ['Name,Note', 'A,"one, two"', 'B,"line one\nline two"', 'C,plain'].join("\r\n");
    const parts = splitCsvText(text, 2);
    expect(parts).toEqual(['Name,Note\nA,"one, two"\nB,"line one\nline two"', "Name,Note\nC,plain"]);
  });

  it("the parts' answers read as one, with row numbers in the whole file", () => {
    const base = { dry_run: true, kind: "csv" as const, headers: ["Name"], ignored_columns: [], fields: {}, warnings: [], errors: [], skipped: 0, waiting: 0, same_name: 0 };
    const one: ImportSummary = { ...base, total: 500, created: 499, updated: 0, failed: 1, failed_rows: [{ row: 7, status: "failed" as const, messages: ["Price"], cells: {} }], unknown_categories: [{ name: "Caps", rows: 3, suggestion: null }] };
    const two: ImportSummary = { ...base, total: 200, created: 190, updated: 10, failed: 0, failed_rows: [], unknown_categories: [{ name: "Caps", rows: 2, suggestion: { id: "c1", path: "Accessories > Caps" } }] };

    const all = mergeSummaries([{ summary: one, rowsBefore: 0 }, { summary: two, rowsBefore: 500 }]);

    expect([all.total, all.created, all.updated, all.failed]).toEqual([700, 689, 10, 1]);
    expect(all.failed_rows[0].row).toBe(7);
    expect(all.unknown_categories).toEqual([{ name: "Caps", rows: 5, suggestion: { id: "c1", path: "Accessories > Caps" } }]);
    const shifted = mergeSummaries([{ summary: two, rowsBefore: 0 }, { summary: one, rowsBefore: 200 }]);
    expect(shifted.failed_rows[0].row).toBe(207);
  });
});
