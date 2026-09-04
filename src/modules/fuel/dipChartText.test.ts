import { describe, expect, it } from "vitest";

import { dipChartToText, parseDipChart } from "./dipChartText";

/**
 * The parser's whole job is to accept what a station ACTUALLY HAS — a printed
 * table, a spreadsheet column, a PDF — rather than what a form would prefer.
 * A chart nobody manages to paste is a chart nobody loads, and a tank with no
 * chart sends the operator back to a torch and a paper lookup.
 */
describe("pasting a calibration chart", () => {
  it("takes a tab-separated paste out of a spreadsheet", () => {
    const { points } = parseDipChart("0\t0\n500\t8000\n1000\t20000");

    expect(points).toEqual([
      { mm: 0, litres: 0 },
      { mm: 500, litres: 8000 },
      { mm: 1000, litres: 20000 },
    ]);
  });

  it("takes commas, semicolons and runs of spaces the same way", () => {
    expect(parseDipChart("0,0\n500;8000\n1000   20000").points).toHaveLength(3);
  });

  it("strips the thousands separators a spreadsheet leaves behind", () => {
    expect(parseDipChart("620\t12,500").points).toEqual([{ mm: 620, litres: 12500 }]);
  });

  it("ignores a header row instead of calling it an error", () => {
    // Normal at the top of a pasted table, and reporting it would teach the
    // reader to ignore the rejected list — which is where the real mistakes go.
    const { points, rejected } = parseDipChart("mm, litres\n0, 0\n500, 8000");

    expect(points).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });

  it("sorts by depth, because a pasted table is not always in order", () => {
    expect(parseDipChart("1000\t20000\n0\t0\n500\t8000").points.map((p) => p.mm))
      .toEqual([0, 500, 1000]);
  });

  it("names a depth listed twice rather than letting the second win", () => {
    const { points, rejected } = parseDipChart("500\t8000\n500\t9000");

    expect(points).toEqual([{ mm: 500, litres: 8000 }]);
    expect(rejected).toEqual([{ line: 2, text: "500\t9000" }]);
  });

  it("names a line that is not two numbers", () => {
    const { points, rejected } = parseDipChart("0\t0\nabout half full\n500\t8000");

    expect(points).toHaveLength(2);
    expect(rejected).toEqual([{ line: 2, text: "about half full" }]);
  });

  it("has no opinion about the shape of the curve", () => {
    // A cylinder, a rectangular bowser and a vertical silo produce completely
    // different curves, and half a chart is a twenty-year-old certificate. The
    // one check that belongs here is "is this two numbers"; whether a deeper
    // reading holds more is the server's, on the whole chart at once.
    const { points, rejected } = parseDipChart("0\t0\n500\t20000\n1000\t8000");

    expect(points).toHaveLength(3);
    expect(rejected).toHaveLength(0);
  });

  it("round-trips, so a loaded chart can be corrected instead of re-pasted", () => {
    const points = [{ mm: 0, litres: 0 }, { mm: 500, litres: 8000.5 }];

    expect(parseDipChart(dipChartToText(points)).points).toEqual(points);
  });
});
