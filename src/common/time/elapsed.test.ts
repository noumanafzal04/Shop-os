import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { elapsedLabel, minutesSince, urgencyOf } from "./elapsed";

const NOW = new Date(2026, 7, 26, 14, 0, 0);
const agoMinutes = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe("elapsedLabel", () => {
  it("reads at a glance at every scale a queue runs on", () => {
    expect(elapsedLabel(agoMinutes(0))).toBe("just now");
    expect(elapsedLabel(agoMinutes(12))).toBe("12m");
    expect(elapsedLabel(agoMinutes(65))).toBe("1h 05m");
    expect(elapsedLabel(agoMinutes(120))).toBe("2h");
    expect(elapsedLabel(agoMinutes(60 * 26))).toBe("1d");
  });

  it("pads the minutes so 1h 5m never reads as 1h 50m", () => {
    expect(elapsedLabel(agoMinutes(61))).toBe("1h 01m");
  });

  it("does not report a future timestamp as a negative wait", () => {
    // A till whose clock is a minute ahead of the server is ordinary, and
    // "-1m" on a card is a bug the shop reports rather than an oddity.
    expect(minutesSince(new Date(NOW.getTime() + 90_000).toISOString())).toBe(0);
    expect(elapsedLabel(new Date(NOW.getTime() + 90_000).toISOString())).toBe("just now");
  });
});

describe("urgencyOf", () => {
  it("is harsher about an order nobody has acknowledged", () => {
    // Fifteen minutes unconfirmed is late; fifteen minutes on a bike is not.
    expect(urgencyOf(agoMinutes(16), "pending")).toBe("late");
    expect(urgencyOf(agoMinutes(16), "out_for_delivery")).toBe("calm");
  });

  it("steps through calm, warm and late at its own stage's thresholds", () => {
    expect(urgencyOf(agoMinutes(2), "pending")).toBe("calm");
    expect(urgencyOf(agoMinutes(6), "pending")).toBe("warm");
    expect(urgencyOf(agoMinutes(20), "pending")).toBe("late");
  });

  it("says nothing is late once nobody is waiting", () => {
    // A completed order from last week is not an emergency, and a queue that
    // turns red for finished work is a queue people stop reading.
    expect(urgencyOf(agoMinutes(60 * 24 * 7), "completed")).toBe("calm");
    expect(urgencyOf(agoMinutes(60 * 24 * 7), "cancelled")).toBe("calm");
  });

  it("has a threshold for every stage a customer can be waiting through", () => {
    // The denominator. A stage missing from the map silently falls back to
    // 30/60, which is wrong for `pending` in the direction that costs money.
    for (const stage of ["pending", "confirmed", "preparing", "ready", "out_for_delivery"]) {
      expect(urgencyOf(agoMinutes(9999), stage), stage).toBe("late");
      expect(urgencyOf(agoMinutes(0), stage), stage).toBe("calm");
    }
  });
});
