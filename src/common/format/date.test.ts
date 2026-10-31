import { describe, expect, it } from "vitest";

import {
  DATE_FORMAT_CODES, DEFAULT_DATE_FORMAT, dateFormatOf, dateIn, dateTimeIn, monthName, monthYear,
  setShopDateFormat, shopDate, shopDateFormat, shopDateTime, shopShortDate, shortDateIn, shortDateTimeIn, timeOf, typedDayIn,
  type DateFormatCode,
} from "./date";
import fixtures from "./fixtures/date-format.json";

/**
 * The fixture is written by the SERVER (`DateFormatFixturesTest`). A screen
 * and a receipt write the same day from two languages, and this is what keeps
 * them saying the same thing.
 */
const cases = fixtures.cases as Array<{ code: DateFormatCode; day: string; long: string; short: string }>;

describe("a day, written the way the shop writes dates", () => {
  it("has the list the server has, and its default", () => {
    expect(fixtures.formats.map((f) => f.code)).toEqual([...DATE_FORMAT_CODES]);
    expect(fixtures.default).toBe(DEFAULT_DATE_FORMAT);
  });

  it.each(cases)("$code writes $day as “$long”", ({ code, day, long, short }) => {
    expect(dateIn(code, day)).toBe(long);
    expect(shortDateIn(code, day)).toBe(short);
  });

  it("shows each format the way the settings screen offers it", () => {
    for (const { code, example } of fixtures.formats) expect(dateIn(code as DateFormatCode, "2026-10-12")).toBe(example);
  });

  it("is the day it says, whatever the clock on the wall — a day is never moved to a time zone", () => {
    // `new Date("2026-10-12")` is midnight UTC: the 11th, west of Greenwich.
    // Read as its own three numbers, it is the 12th everywhere.
    expect(dateIn("dmy_text", "2026-01-01")).toBe("1 Jan 2026");
    expect(dateIn("dmy_text", "2025-12-31")).toBe("31 Dec 2025");
  });

  it("writes nothing for no date, and nothing for something that is not one", () => {
    for (const nothing of [null, undefined, "", "not a date", "2026-02-30", "2026-13-01"]) {
      expect(dateIn("dmy", nothing)).toBe("");
      expect(shortDateIn("dmy", nothing)).toBe("");
      expect(dateTimeIn("dmy", nothing)).toBe("");
      expect(timeOf(nothing)).toBe("");
    }
  });

  it("falls back to the default for a format it was never sent", () => {
    expect(dateFormatOf("dmy")).toBe("dmy");
    for (const odd of [undefined, null, "", "DD/MM", 7]) expect(dateFormatOf(odd)).toBe(DEFAULT_DATE_FORMAT);
  });

});

describe("a moment, as the clock in front of the reader had it", () => {
  // Built from local numbers, so the test says the same thing in any zone.
  const afternoon = new Date(2026, 9, 5, 17, 14, 20);
  const midnight = new Date(2026, 9, 5, 0, 5);
  const noon = new Date(2026, 9, 5, 12, 0);

  it("writes the date the shop's way and the clock one way", () => {
    expect(dateTimeIn("dmy_text", afternoon)).toBe("5 Oct 2026, 5:14 PM");
    expect(dateTimeIn("dmy", afternoon)).toBe("05/10/2026, 5:14 PM");
    expect(dateTimeIn("mdy", afternoon)).toBe("10/05/2026, 5:14 PM");
    expect(dateTimeIn("ymd", afternoon)).toBe("2026-10-05, 5:14 PM");
    expect(shortDateTimeIn("dmy_text", afternoon)).toBe("5 Oct, 5:14 PM");
  });

  it("calls midnight twelve and noon twelve", () => {
    expect(timeOf(midnight)).toBe("12:05 AM");
    expect(timeOf(noon)).toBe("12:00 PM");
    expect(timeOf(afternoon)).toBe("5:14 PM");
  });

  it("takes the moment as a string or a number too", () => {
    expect(dateIn("dmy_text", afternoon.toISOString())).toBe("5 Oct 2026");
    expect(dateIn("dmy_text", afternoon.getTime())).toBe("5 Oct 2026");
  });

  it("names a month the same in every format", () => {
    expect(monthName("2026-10-12")).toBe("Oct");
    expect(monthName("2026-10-12", true)).toBe("October");
    expect(monthYear("2026-10-12")).toBe("October 2026");
  });
});

describe("what somebody types into a date box", () => {
  const today = new Date(2026, 9, 12);
  const typed = (code: DateFormatCode, text: string) => typedDayIn(code, text, today);

  it.each([
    "12/10/2026", "12-10-2026", "12.10.2026", "12 10 2026", "12/10/26", "12102026", "121026", "12/10", "12-10",
    "12 oct", "12 Oct 2026", "12-Oct-26", "12oct", "12 October 2026", "oct 12", "Oct 12, 2026", "october 12 2026", "2026-10-12", "2026/10/12",
  ])("“%s” is the twelfth of October where the day is written first", (text) => {
    expect(typed("dmy", text)).toBe("2026-10-12");
    expect(typed("dmy_text", text)).toBe("2026-10-12");
  });

  it("reads two bare numbers in the shop's own order — and only there does the format change the meaning", () => {
    expect(typed("dmy", "12/10/2026")).toBe("2026-10-12");
    expect(typed("mdy", "12/10/2026")).toBe("2026-12-10");
    expect(typed("mdy", "10/12/2026")).toBe("2026-10-12");
    expect(typed("mdy", "10122026")).toBe("2026-10-12");
    // A month by name, or the year first, is the same day in every shop.
    for (const code of DATE_FORMAT_CODES) {
      expect(typed(code, "12 oct 2026")).toBe("2026-10-12");
      expect(typed(code, "2026-10-12")).toBe("2026-10-12");
    }
  });

  it("takes a single digit where a single digit was typed", () => {
    expect(typed("dmy", "5/3/2026")).toBe("2026-03-05");
    expect(typed("dmy", "5 mar")).toBe("2026-03-05");
  });

  it("knows today, tomorrow and yesterday", () => {
    expect(typed("dmy", "today")).toBe("2026-10-12");
    expect(typed("dmy", "Tomorrow")).toBe("2026-10-13");
    expect(typed("dmy", "yesterday")).toBe("2026-10-11");
  });

  it.each(["", "   ", "31/02/2026", "32/01/2026", "12/13/2026", "hello", "12 xyz 2026", "1210", "2026-13-01", "0/0/0", "12/10/20266"])(
    "“%s” is not a day",
    (text) => {
      expect(typed("dmy", text)).toBeNull();
    },
  );

  it("does not take a month's name that is only a beginning of nothing", () => {
    expect(typed("dmy", "12 ma")).toBeNull();
    expect(typed("dmy", "12 mar")).toBe("2026-03-12");
    expect(typed("dmy", "12 may")).toBe("2026-05-12");
    expect(typed("dmy", "12 marc")).toBe("2026-03-12");
    expect(typed("dmy", "12 marx")).toBeNull();
  });
});

describe("this shop's way, held once for every screen", () => {
  it("is the default until a shop says otherwise — and for nobody's shop", () => {
    setShopDateFormat(null);

    expect(shopDateFormat()).toBe(DEFAULT_DATE_FORMAT);
    expect(shopDate("2026-10-12")).toBe("12 Oct 2026");
    expect(localStorage.getItem("shopos-dates")).toBeNull();
  });

  it("writes every date the way the shop was told to, from then on", () => {
    setShopDateFormat("mdy");

    expect(shopDate("2026-10-12")).toBe("10/12/2026");
    expect(shopShortDate("2026-10-12")).toBe("10/12");
    expect(shopDateTime(new Date(2026, 9, 12, 9, 5))).toBe("10/12/2026, 9:05 AM");

    setShopDateFormat("dmy");
    expect(shopDate("2026-10-12")).toBe("12/10/2026");
    setShopDateFormat(null);
  });

  it("is kept on the device, so the first screen of the next visit is already right", () => {
    setShopDateFormat("ymd");
    expect(localStorage.getItem("shopos-dates")).toBe("ymd");

    // Signed out, or the console opened: forgotten, and back to the default.
    setShopDateFormat(null);
    expect(localStorage.getItem("shopos-dates")).toBeNull();
    expect(shopDate("2026-10-12")).toBe("12 Oct 2026");
  });
});
