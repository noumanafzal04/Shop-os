import { fs, path, PROJECT_ROOT, codeOnly } from "./support/node";
import { monthGrid, parseYmd, PRESETS, rangeLabel, tapDay, ymd } from "../src/modules/money/dateRange";

/**
 * "MONEY TAB MAIN CUSTOM FILTER, RANGE DATE FILTER." The server already took
 * `period=custom&from=&to=`; the tab offered only fixed periods. These are the
 * rules of the range sheet.
 */
const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

describe("a date range for the money tab", () => {
  const now = new Date(2026, 10, 20, 1, 30); // 20 Nov 2026, 01:30 local

  it("writes the LOCAL day — at 01:30 it is still the 20th, not UTC's 19th", () => {
    expect(ymd(now)).toBe("2026-11-20");
    expect(ymd(parseYmd("2026-03-01"))).toBe("2026-03-01");
  });

  it("presets cover the days a shopkeeper asks about", () => {
    const r = Object.fromEntries(PRESETS.map((p) => [p.key, p.range(now)]));
    expect(r.yesterday).toEqual({ from: "2026-11-19", to: "2026-11-19" });
    expect(r.last7).toEqual({ from: "2026-11-14", to: "2026-11-20" });
    expect(r.last30).toEqual({ from: "2026-10-22", to: "2026-11-20" });
    expect(r.lastMonth).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("first tap starts, second ends (in either order), third starts again; no future days", () => {
    const today = "2026-11-20";
    let p = tapDay({ from: null, to: null }, "2026-11-10", today);
    expect(p).toEqual({ from: "2026-11-10", to: null });
    p = tapDay(p, "2026-11-04", today);
    expect(p).toEqual({ from: "2026-11-04", to: "2026-11-10" });
    p = tapDay(p, "2026-11-12", today);
    expect(p).toEqual({ from: "2026-11-12", to: null });
    expect(tapDay(p, "2026-11-25", today)).toBe(p);
  });

  it("draws a month Monday-first, padded to whole weeks", () => {
    const g = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(g[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(g.every((row) => row.length === 7)).toBe(true);
    expect(g.flat().filter(Boolean)).toHaveLength(30);
  });

  it("labels a range briefly", () => {
    expect(rangeLabel({ from: "2026-11-12", to: "2026-11-20" })).toBe("12 Nov – 20 Nov");
    expect(rangeLabel({ from: "2026-11-03", to: "2026-11-03" })).toBe("3 Nov");
    expect(rangeLabel({ from: "2025-12-28", to: "2026-01-03" })).toBe("28 Dec 2025 – 3 Jan 2026");
  });

  it("the tab sends a custom range to the server, keyed by its dates", () => {
    const svc = read("src/modules/money/services/moneyService.ts");
    expect(svc).toMatch(/period === "custom" && range \? \{ period, from: range\.from, to: range\.to \}/);
    const hook = read("src/modules/money/hooks/useMoney.ts");
    expect(hook).toMatch(/queryKey: \["summary", period, custom\?\.from \?\? null, custom\?\.to \?\? null\]/);
    expect(read("src/modules/money/screens/MoneyScreen.tsx")).toMatch(/<RangeSheet/);
  });
});
