import { afterEach, describe, expect, it } from "vitest";

import {
  setShopDayRule, shopDateOf, shopToday, shopTodayDate, shopWallToday, turnsAtLabel,
  turnHourChoices, usualTurnMinutes, zoneOffsetMinutes,
} from "./shopDay";

/**
 * The same hours the server's own test asks about (AShopsDayTurnsOnceTest),
 * so the two halves of one rule are held to one set of answers.
 */
const karachi = (wall: string): Date => new Date(`${wall}+05:00`);

const FIVE = { zone: "Asia/Karachi", turnsAtMinutes: 300 };
const MIDNIGHT = { zone: "Asia/Karachi", turnsAtMinutes: 0 };

afterEach(() => setShopDayRule(null));

describe("a shop's day", () => {
  it("runs on past midnight and turns at five", () => {
    expect(shopDateOf(karachi("2026-10-06T23:59:00"), FIVE)).toBe("2026-10-06");
    expect(shopDateOf(karachi("2026-10-07T01:30:00"), FIVE)).toBe("2026-10-06");
    expect(shopDateOf(karachi("2026-10-07T04:59:59"), FIVE)).toBe("2026-10-06");
    expect(shopDateOf(karachi("2026-10-07T05:00:00"), FIVE)).toBe("2026-10-07");
  });

  it("turns at midnight for a shop that chose midnight", () => {
    expect(shopDateOf(karachi("2026-10-06T23:59:59"), MIDNIGHT)).toBe("2026-10-06");
    expect(shopDateOf(karachi("2026-10-07T00:00:00"), MIDNIGHT)).toBe("2026-10-07");
  });

  it("turns at an hour of the shop's own", () => {
    const three = { zone: "Asia/Karachi", turnsAtMinutes: 180 };

    expect(shopDateOf(karachi("2026-10-07T02:59:59"), three)).toBe("2026-10-06");
    expect(shopDateOf(karachi("2026-10-07T03:00:00"), three)).toBe("2026-10-07");
  });

  it("is read on the SHOP'S clock, wherever the device thinks it is", () => {
    // The same instant, asked of a shop in Karachi and one in Dubai: 22:30
    // UTC is half past three in Karachi and half past two in Dubai.
    const instant = new Date("2026-10-06T22:30:00Z");

    expect(shopDateOf(instant, { zone: "Asia/Karachi", turnsAtMinutes: 180 })).toBe("2026-10-07");
    expect(shopDateOf(instant, { zone: "Asia/Dubai", turnsAtMinutes: 180 })).toBe("2026-10-06");
  });

  it("crosses a month and a year with the evening it belongs to", () => {
    expect(shopDateOf(karachi("2026-11-01T02:00:00"), FIVE)).toBe("2026-10-31");
    expect(shopDateOf(karachi("2027-01-01T04:00:00"), FIVE)).toBe("2026-12-31");
  });
});

describe("today", () => {
  it("is the business day once the shop has said its rule", () => {
    setShopDayRule(FIVE);

    expect(shopToday(karachi("2026-10-07T01:30:00"))).toBe("2026-10-06");
    // The date on the wall is the 7th all the same.
    expect(shopWallToday(karachi("2026-10-07T01:30:00"))).toBe("2026-10-07");
    expect(shopToday(karachi("2026-10-07T05:00:00"))).toBe("2026-10-07");
  });

  it("is a Date whose local parts are that day, for range arithmetic", () => {
    setShopDayRule(FIVE);
    const date = shopTodayDate(karachi("2026-11-01T02:00:00"));

    expect([date.getFullYear(), date.getMonth() + 1, date.getDate()]).toEqual([2026, 10, 31]);
  });

  it("is the device's own date when nobody's shop is open", () => {
    setShopDayRule(null);
    const now = new Date(2026, 9, 7, 1, 30);

    expect(shopToday(now)).toBe("2026-10-07");
    expect(shopWallToday(now)).toBe("2026-10-07");
  });

  it("falls back to the device rather than break on a zone it does not know", () => {
    const now = new Date(2026, 9, 7, 12, 0);

    expect(shopDateOf(now, { zone: "Mars/Olympus", turnsAtMinutes: 0 })).toBe("2026-10-07");
  });
});

describe("the rule is kept on the device", () => {
  const stored = () => JSON.parse(localStorage.getItem("shopos-day") ?? "null") as unknown;
  // One in the morning in Karachi: the 6th by a five o'clock rule, the 7th by
  // midnight, and the 7th again on a device that has no shop.
  const oneAm = karachi("2026-10-07T01:00:00");

  it("is remembered, and forgotten when the shop is left", () => {
    setShopDayRule(FIVE);
    expect(stored()).toEqual(FIVE);
    expect(shopToday(oneAm)).toBe("2026-10-06");

    setShopDayRule(MIDNIGHT);
    expect(stored()).toEqual(MIDNIGHT);
    expect(shopToday(oneAm)).toBe("2026-10-07");

    setShopDayRule(null);
    expect(stored()).toBeNull();
  });

  it("refuses a rule that is not one, rather than keep the last shop's", () => {
    for (const broken of [
      { zone: "", turnsAtMinutes: 300 },
      { zone: "Asia/Karachi", turnsAtMinutes: 24 * 60 },
      { zone: "Asia/Karachi", turnsAtMinutes: -1 },
      { zone: "Asia/Karachi", turnsAtMinutes: Number.NaN },
    ]) {
      setShopDayRule(FIVE);
      setShopDayRule(broken);

      expect(stored(), JSON.stringify(broken)).toBeNull();
    }
  });
});

describe("saying the hour", () => {
  it("reads as a person would say it", () => {
    expect(turnsAtLabel(0)).toBe("midnight");
    expect(turnsAtLabel(60)).toBe("1 am");
    expect(turnsAtLabel(300)).toBe("5 am");
    expect(turnsAtLabel(330)).toBe("5:30 am");
    expect(turnsAtLabel(480)).toBe("8 am");
  });
});

describe("where a day turns when the shop has not said", () => {
  // The server's rule (ShopDay::frame), so the settings screen names the
  // same default the server is applying.
  it("is midnight UTC on the shop's own clock, in the small hours", () => {
    expect(zoneOffsetMinutes("Asia/Karachi")).toBe(300);
    expect(usualTurnMinutes("Asia/Karachi")).toBe(300);
    expect(usualTurnMinutes("Asia/Kolkata")).toBe(330);
    expect(usualTurnMinutes("Asia/Dubai")).toBe(240);
    expect(usualTurnMinutes("UTC")).toBe(0);
  });

  it("is the shop's own midnight anywhere that would not be the small hours", () => {
    expect(zoneOffsetMinutes("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(-300);
    expect(usualTurnMinutes("America/New_York")).toBe(0);
    expect(usualTurnMinutes("Pacific/Auckland")).toBe(0);
    expect(usualTurnMinutes("Mars/Olympus")).toBe(0);
  });
});

describe("the hours a shop may choose", () => {
  it("offers the usual first — and says what the usual is", () => {
    const choices = turnHourChoices("Asia/Karachi");

    expect(choices[0]).toEqual({ value: "usual", label: "The usual — 5 am" });
    expect(turnHourChoices("Asia/Dubai")[0].label).toBe("The usual — 4 am");
    expect(turnHourChoices("America/New_York")[0].label).toBe("The usual — midnight");
  });

  it("then midnight and every hour the server will accept, and no other", () => {
    const choices = turnHourChoices("Asia/Karachi").slice(1);

    expect(choices.map((c) => c.value)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(choices.map((c) => c.label)).toEqual(["Midnight", "1 am", "2 am", "3 am", "4 am", "5 am", "6 am", "7 am", "8 am"]);
  });
});
