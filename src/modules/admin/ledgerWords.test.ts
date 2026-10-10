import { describe, expect, it } from "vitest";

import { ANY_DATE, datesName, ledgerDates, ledgerEmpty, ledgerNote, ledgerTotalNote } from "./ledgerWords";

// The platform's 10th of October.
const TODAY = new Date(2026, 9, 10);
const THIS_MONTH = { from: "2026-10-01", to: "2026-10-10" };
const LAST_MONTH = { from: "2026-09-01", to: "2026-09-30" };
const EID = { from: "2026-05-26", to: "2026-05-29" };

describe("whose dates the billing ledger is showing", () => {
  it("follows the period until it is given dates of its own", () => {
    expect(ledgerDates(THIS_MONTH, null)).toEqual(THIS_MONTH);
    expect(ledgerDates(THIS_MONTH, LAST_MONTH)).toEqual(LAST_MONTH);
  });

  it("any date, chosen, is not the same as following", () => {
    // The whole reason `own` is not a boolean: an archive search asked for
    // every date must not snap back to the period.
    expect(ledgerDates(THIS_MONTH, ANY_DATE)).toEqual(ANY_DATE);
  });

  it("names a period the way the menu does, and dates nobody named by the dates", () => {
    expect(datesName(THIS_MONTH, TODAY)).toBe("This month");
    expect(datesName(LAST_MONTH, TODAY)).toBe("Last month");
    expect(datesName(EID, TODAY)).toBe("26 – 29 May");
  });

  it("says which it is doing", () => {
    expect(ledgerNote(LAST_MONTH, null, TODAY)).toBe("Following the period above — Last month. Clear the date to search every payment.");
    expect(ledgerNote(THIS_MONTH, EID, TODAY)).toBe("Its own dates — 26 – 29 May — not the period above.");
    expect(ledgerNote(THIS_MONTH, ANY_DATE, TODAY)).toBe("Every payment recorded, whatever the period above.");
  });
});

describe("what the ledger's total is the total of", () => {
  it("is the period's by name, all time with no dates, and a filter once it is narrowed", () => {
    expect(ledgerTotalNote(THIS_MONTH, false, TODAY)).toBe("This month");
    expect(ledgerTotalNote(EID, false, TODAY)).toBe("26 – 29 May");
    expect(ledgerTotalNote(ANY_DATE, false, TODAY)).toBe("all time");
    // A search inside this month is not "this month's total".
    expect(ledgerTotalNote(THIS_MONTH, true, TODAY)).toBe("in this filter");
    expect(ledgerTotalNote(ANY_DATE, true, TODAY)).toBe("in this filter");
  });
});

describe("an empty ledger", () => {
  it("under a period, a search that finds nothing says the payment may be on another date — and offers them all", () => {
    expect(ledgerEmpty(THIS_MONTH, true, TODAY)).toEqual({
      says: "No payment in This month matches — it may be on another date.",
      offerEveryDate: true,
    });
  });

  it("a period nothing was paid in says so, and still offers every date", () => {
    expect(ledgerEmpty(LAST_MONTH, false, TODAY)).toEqual({ says: "No payments in Last month.", offerEveryDate: true });
  });

  it("with every date already asked for there is nothing more to offer", () => {
    expect(ledgerEmpty(ANY_DATE, true, TODAY)).toEqual({ says: "No payment matches these filters.", offerEveryDate: false });
    expect(ledgerEmpty(ANY_DATE, false, TODAY)).toEqual({ says: "No payments recorded yet.", offerEveryDate: false });
  });
});
