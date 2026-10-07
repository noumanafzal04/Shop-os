import { afterEach, describe, expect, it } from "vitest";
import { isWaiting, nextMidnight, rateTiming } from "./rateTiming";

const was = process.env.TZ;
afterEach(() => {
  if (was === undefined) delete process.env.TZ;
  else process.env.TZ = was;
});

const NOW = new Date("2026-10-15T15:00:00.000Z"); // eight in the evening in Lahore

describe("when a new rate takes effect", () => {
  it("is now, when the station says now — and nothing is sent", () => {
    expect(rateTiming(false, "2026-10-16T00:00", NOW)).toEqual({ effectiveAt: undefined, problem: null });
  });

  it("is midnight in Lahore, sent as the moment it is", () => {
    process.env.TZ = "Asia/Karachi";
    expect(rateTiming(true, "2026-10-16T00:00", NOW)).toEqual({ effectiveAt: "2026-10-15T19:00:00.000Z", problem: null });
  });

  it("cannot be 'later' with no time said", () => {
    expect(rateTiming(true, "", NOW)).toEqual({ effectiveAt: undefined, problem: "Say when it takes effect." });
  });

  it("cannot be 'later' at a time that has passed", () => {
    process.env.TZ = "Asia/Karachi";
    const past = rateTiming(true, "2026-10-15T19:00", NOW); // seven, an hour ago
    expect(past.effectiveAt).toBeUndefined();
    expect(past.problem).toMatch(/has passed/);
  });

  it("cannot be 'later' at this very instant", () => {
    process.env.TZ = "UTC";
    expect(rateTiming(true, "2026-10-15T15:00", NOW).problem).toMatch(/has passed/);
  });
});

describe("midnight tonight, as the box takes it", () => {
  it("is the start of tomorrow on this device's calendar", () => {
    process.env.TZ = "Asia/Karachi";
    expect(nextMidnight(NOW)).toBe("2026-10-16T00:00");
  });

  it("rolls over a month end", () => {
    process.env.TZ = "UTC";
    expect(nextMidnight(new Date("2026-10-31T20:00:00.000Z"))).toBe("2026-11-01T00:00");
  });
});

describe("a rate that is waiting for its hour", () => {
  it("is one not yet applied, due later", () => {
    expect(isWaiting({ effective_at: "2026-10-15T19:00:00.000Z", applied_at: null }, NOW)).toBe(true);
  });

  it("is not one that has been applied", () => {
    expect(isWaiting({ effective_at: "2026-10-15T19:00:00.000Z", applied_at: "2026-10-15T19:00:05.000Z" }, NOW)).toBe(false);
  });

  it("is not one whose hour has come", () => {
    expect(isWaiting({ effective_at: "2026-10-15T14:00:00.000Z", applied_at: null }, NOW)).toBe(false);
  });
});
