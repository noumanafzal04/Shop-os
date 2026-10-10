import { describe, expect, it } from "vitest";

/**
 * A DATE PICKED ON THE CONSOLE IS PICKED ON THE SERVER'S CALENDAR.
 *
 * Platform figures are cut in UTC and read in Pakistan, where the first five
 * hours of every day are still "yesterday" to the server. The dashboard was
 * given the server's date; billing, the audit trail and commission each kept
 * a date control that asked the laptop — so "Today" at 1 am answered with an
 * empty day, and the day's real entries sat under the date before.
 *
 * Three screens was the count when this was written. The rule is for the
 * fourth: any date control on a console page is told what today is.
 */
const PAGES = import.meta.glob("./pages/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Every `<DateRangeFilter … />` on a page, as written. */
function pickers(source: string): string[] {
  const out: string[] = [];
  let at = source.indexOf("<DateRangeFilter");

  while (at !== -1) {
    const end = source.indexOf("/>", at);
    out.push(source.slice(at, end + 2));
    at = source.indexOf("<DateRangeFilter", end);
  }

  return out;
}

describe("a date picked on the console is picked on the server's calendar", () => {
  const found = Object.entries(PAGES).flatMap(([file, source]) => pickers(source).map((picker) => ({ file, picker })));

  it("is looking at the console's pages, and they do pick dates", () => {
    expect(Object.keys(PAGES).length).toBeGreaterThan(10);
    expect(found.map((f) => f.file.split("/").pop()).sort()).toEqual(
      ["AdminAuditPage.tsx", "AdminCommissionPage.tsx", "AdminPaymentsPage.tsx"].sort(),
    );
  });

  it("every date control on a console page is told the platform's today", () => {
    const asksTheLaptop = found.filter((f) => !/\btoday=\{platformToday\(\)\}/.test(f.picker)).map((f) => f.file);

    expect(asksTheLaptop, "these date controls resolve Today on the laptop's calendar").toEqual([]);
  });

  it("no console page works a range out from the laptop's clock", () => {
    const offenders = Object.entries(PAGES)
      .filter(([, source]) => /resolveRange\([^)]*new Date\(\)/.test(source))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });
});
