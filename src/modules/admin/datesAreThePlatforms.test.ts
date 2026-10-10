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

/** Every date control on a page, as written: the filter itself, and the period bar that wraps one. */
function pickers(source: string): string[] {
  const out: string[] = [];

  for (const tag of ["<DateRangeFilter", "<PeriodBar"]) {
    let at = source.indexOf(tag);

    while (at !== -1) {
      const end = source.indexOf("/>", at);
      out.push(source.slice(at, end + 2));
      at = source.indexOf(tag, end);
    }
  }

  return out;
}

/**
 * Whether a control is told the platform's today.
 *
 * Either in so many words — `today={platformToday()}` — or as the page's own
 * `today`, when that is the date the SERVER said it is with the platform's
 * as the stand-in until it answers. That second form is the better one (it
 * is the server's calendar itself, not this laptop's reading of it), and it
 * is held to its declaration: a `today` made from `new Date()` is the fault
 * this file exists for, under a name that would have passed.
 */
function isTold(picker: string, source: string): boolean {
  if (/\btoday=\{platformToday\(\)\}/.test(picker)) return true;
  if (!/\btoday=\{today\}/.test(picker)) return false;

  const declared = source.match(/\bconst today = ([^;]+);/)?.[1] ?? "";

  return /platformToday\(\)/.test(declared) && !/new Date\(/.test(declared);
}

describe("a date picked on the console is picked on the server's calendar", () => {
  const found = Object.entries(PAGES).flatMap(([file, source]) => pickers(source).map((picker) => ({ file, picker, source })));

  it("is looking at the console's pages, and they do pick dates", () => {
    expect(Object.keys(PAGES).length).toBeGreaterThan(10);
    expect([...new Set(found.map((f) => f.file.split("/").pop()))].sort()).toEqual(
      ["AdminAuditPage.tsx", "AdminCommissionPage.tsx", "AdminPaymentsPage.tsx"].sort(),
    );
    // Billing has two: the period at its head, and the ledger's own dates.
    expect(found.filter((f) => f.file.endsWith("AdminPaymentsPage.tsx")).length).toBe(2);
  });

  it("every date control on a console page is told the platform's today", () => {
    const asksTheLaptop = found.filter((f) => !isTold(f.picker, f.source)).map((f) => f.file);

    expect(asksTheLaptop, "these date controls resolve Today on the laptop's calendar").toEqual([]);
  });

  it("a page's own `today` only counts when it is the server's, with the platform's as its stand-in", () => {
    const picker = "<DateRangeFilter today={today} />";

    expect(isTold(picker, "const today = s ? fromIsoDate(s.period.today) : platformToday();")).toBe(true);
    expect(isTold(picker, "const today = new Date();")).toBe(false);
    expect(isTold(picker, "const today = s ? fromIsoDate(s.period.today) : new Date();")).toBe(false);
    // Told nothing at all, it resolves Today itself — on the laptop.
    expect(isTold("<DateRangeFilter value={range} />", "const today = platformToday();")).toBe(false);
    expect(isTold("<PeriodBar range={asked} />", "const today = platformToday();")).toBe(false);
  });

  it("no console page works a range out from the laptop's clock", () => {
    const offenders = Object.entries(PAGES)
      .filter(([, source]) => /resolveRange\([^)]*new Date\(\)/.test(source))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });
});
