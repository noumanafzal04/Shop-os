import { afterEach, describe, expect, it } from "vitest";

import { setShopDayRule } from "../shopDay";
import { daysSince, sinceWords, tradingDay } from "./since";

describe("how long ago, in the shop's days", () => {
  afterEach(() => setShopDayRule(null));

  it("says today, yesterday, and a count", () => {
    setShopDayRule({ zone: "Asia/Karachi", turnsAtMinutes: 5 * 60 });
    const now = new Date("2026-10-15T10:00:00Z"); // 15:00 in Karachi

    expect(sinceWords("2026-10-15T06:00:00Z", now)).toBe("today");
    expect(sinceWords("2026-10-14T10:00:00Z", now)).toBe("yesterday");
    expect(sinceWords("2026-09-07T10:00:00Z", now)).toBe("38 days ago");
    expect(sinceWords(null, now)).toBeNull();
  });

  it("counts business days: 23:50 the night before is still yesterday until the day turns", () => {
    setShopDayRule({ zone: "Asia/Karachi", turnsAtMinutes: 5 * 60 });
    // 01:30 on the 15th in Karachi is still the 14th's business day.
    const night = new Date("2026-10-14T20:30:00Z");

    expect(daysSince("2026-10-14T18:50:00Z", night)).toBe(0);
  });
});

describe("the trading day a moment belongs to (wholesale #W3)", () => {
  afterEach(() => setShopDayRule(null));

  it("files a sale rung before the day turns under the day it belongs to", () => {
    setShopDayRule({ zone: "Asia/Karachi", turnsAtMinutes: 5 * 60 });
    // 03:04 on the 25th in Karachi — still the 24th's trading.
    expect(tradingDay("2026-10-24T22:04:00Z")).toBe("24 Oct 2026");
    // 06:00 on the 25th — the 25th.
    expect(tradingDay("2026-10-25T01:00:00Z")).toBe("25 Oct 2026");
  });
});
