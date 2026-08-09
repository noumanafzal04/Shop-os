import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { downloadCsv } from "./download";

/**
 * A CSV is only useful if it survives the program it gets opened in.
 *
 * These are not hypothetical: a category called "Rent, shop" splits into two
 * columns unquoted, an Urdu name arrives as mojibake in Excel without a BOM,
 * and a description starting with "-" or "=" is executed as a formula rather
 * than shown. The last one is a genuine security concern, not a cosmetic bug —
 * a merchant's own books shouldn't be able to run something on their machine.
 */
describe("downloadCsv", () => {
  let written = "";

  beforeEach(() => {
    written = "";
    // jsdom implements neither, so these are assigned rather than spied on.
    URL.createObjectURL = vi.fn(() => "blob:stub");
    URL.revokeObjectURL = vi.fn();
    // Capture what actually went into the Blob.
    vi.stubGlobal("Blob", class {
      constructor(parts: string[]) {
        written = parts.join("");
      }
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const body = () => written.replace("﻿", "").split("\r\n");

  it("writes a header row and one row per record", () => {
    downloadCsv("b.csv", ["Category", "Spent"], [["Rent", 25000], ["Utilities", 4200]]);

    expect(body()).toEqual(["Category,Spent", "Rent,25000", "Utilities,4200"]);
  });

  it("quotes a field containing a comma", () => {
    downloadCsv("b.csv", ["Category"], [["Rent, shop"]]);

    expect(body()[1]).toBe('"Rent, shop"');
  });

  it("doubles a quote inside a field", () => {
    downloadCsv("b.csv", ["Category"], [['The "big" one']]);

    expect(body()[1]).toBe('"The ""big"" one"');
  });

  it("quotes a field containing a newline rather than splitting the row", () => {
    downloadCsv("b.csv", ["Note"], [["line one\nline two"]]);

    expect(written).toContain('"line one\nline two"');
    // Three lines, not four: the embedded newline is inside a quoted field.
    expect(body()).toHaveLength(2);
  });

  it("defuses a field a spreadsheet would treat as a formula", () => {
    downloadCsv("b.csv", ["Category"], [["=1+1"], ["-500"], ["+x"], ["@cmd"]]);

    expect(body().slice(1)).toEqual(["'=1+1", "'-500", "'+x", "'@cmd"]);
  });

  it("writes an empty cell for null rather than the word null", () => {
    downloadCsv("b.csv", ["Budget"], [[null]]);

    expect(body()[1]).toBe("");
  });

  it("leads with a BOM so Excel reads UTF-8", () => {
    downloadCsv("b.csv", ["Category"], [["کرایہ"]]);

    expect(written.startsWith("﻿")).toBe(true);
    expect(written).toContain("کرایہ");
  });
});
