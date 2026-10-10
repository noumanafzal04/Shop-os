import { describe, expect, it } from "vitest";

import { resolveRange, toIsoDate } from "../../components/ui/filters";
import { platformToday } from "./platformToday";

/** An instant, said as it is on the server's clock. */
const utc = (iso: string) => new Date(`${iso}Z`);

describe("the platform's own date", () => {
  it("is the server's calendar date, whatever the laptop's is", () => {
    // 01:30 on the 11th in Karachi is 20:30 on the 10th in UTC.
    expect(toIsoDate(platformToday(utc("2026-10-10T20:30:00")))).toBe("2026-10-10");
    // By 05:00 in Karachi the two agree again.
    expect(toIsoDate(platformToday(utc("2026-10-11T00:00:00")))).toBe("2026-10-11");
  });

  it("is local midnight of that date — the shape the date controls work in", () => {
    const day = platformToday(utc("2026-10-10T20:30:00"));

    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 9, 10]);
    expect([day.getHours(), day.getMinutes(), day.getSeconds()]).toEqual([0, 0, 0]);
  });

  it("makes Today and This month the server's, across a month's end", () => {
    // 02:00 on 1 November in Karachi; still 31 October on the server.
    const today = platformToday(utc("2026-10-31T21:00:00"));

    expect(resolveRange("today", today)).toEqual({ from: "2026-10-31", to: "2026-10-31" });
    expect(resolveRange("this_month", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("across a year's end too", () => {
    expect(toIsoDate(platformToday(utc("2026-12-31T23:59:59")))).toBe("2026-12-31");
    expect(toIsoDate(platformToday(utc("2027-01-01T00:00:00")))).toBe("2027-01-01");
  });
});
