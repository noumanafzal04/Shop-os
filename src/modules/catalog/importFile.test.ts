import { describe, expect, it } from "vitest";

import {
  BYTE_ORDER_MARK,
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
