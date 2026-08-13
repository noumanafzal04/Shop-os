import { describe, expect, it } from "vitest";

import { AMBER_AT, pillLabel, standing } from "./offlineStore";

/**
 * Where a till stands, and what it says about it.
 *
 * Both are pure functions on purpose. They are the rule the indicator, the
 * acknowledgement prompt and the owner's roster all read, and a rule that can
 * be checked without a browser is a rule that stays correct.
 */

describe("standing", () => {
  const hours = (days: number) => days * 24;

  it("is green whenever the till can reach the server, whatever its history", () => {
    // Reaching the server IS the proof. A till that has just been in contact
    // cannot be out of contact, however long it was before.
    expect(standing(true, 0, 3)).toBe("green");
    expect(standing(true, hours(99), 3)).toBe("green");
    expect(standing(true, hours(99), null)).toBe("green");
    expect(standing(true, null, 3)).toBe("green");
  });

  it("is green while well inside the shop's window", () => {
    expect(standing(false, 0, 4)).toBe("green");
    expect(standing(false, hours(1), 4)).toBe("green");
    expect(standing(false, hours(2), 4)).toBe("green"); // 2/4 = 0.50
  });

  it("turns amber in the last quarter of the window", () => {
    expect(standing(false, hours(3), 4)).toBe("amber"); // exactly AMBER_AT
    expect(standing(false, hours(6), 8)).toBe("amber");
  });

  it("turns red at the window, not after it", () => {
    // At the limit, not one day past it. A shop given three days has had three
    // days on the third day.
    expect(standing(false, hours(3), 3)).toBe("red");
    expect(standing(false, hours(4), 3)).toBe("red");
    expect(standing(false, hours(40), 3)).toBe("red");
  });

  it("says nothing when no window was ever set", () => {
    // Silence beats a warning derived from a number nobody supplied.
    expect(standing(false, hours(10), null)).toBe("unknown");
    expect(standing(false, hours(10), 0)).toBe("unknown");
    expect(standing(false, hours(10), -1)).toBe("unknown");
  });

  it("says nothing about a tablet that has never heard from the server", () => {
    // A brand new till has no history. Reading that as maximally stale would
    // refuse a shop on its first morning, before it had ever sold anything.
    expect(standing(false, null, 3)).toBe("unknown");
  });

  it("warns before it refuses, on EVERY window an admin can set", () => {
    // The reason this is measured in hours. On a one-day window, whole days
    // give exactly two readings — 0 and 1 — so a shop would go from fine to
    // refused with nothing in between and no chance to act. This walks each
    // window an hour at a time and insists the warning exists.
    for (const windowDays of [1, 2, 3, 5, 7, 14, 30]) {
      const seen = new Set<string>();
      for (let hour = 0; hour <= windowDays * 24; hour += 1) {
        seen.add(standing(false, hour, windowDays));
      }

      expect(seen, `window of ${windowDays} days`).toContain("green");
      expect(seen, `window of ${windowDays} days`).toContain("amber");
      expect(seen, `window of ${windowDays} days`).toContain("red");
    }
  });

  it("gives even the tightest window a warning long enough to act on", () => {
    // A one-day window must not warn at 23:59. Six hours is a shift.
    const windowHours = 24;
    let firstAmber = windowHours;
    for (let hour = 0; hour <= windowHours; hour += 1) {
      if (standing(false, hour, 1) === "amber") {
        firstAmber = hour;
        break;
      }
    }

    expect(windowHours - firstAmber).toBeGreaterThanOrEqual(6);
  });

  it("holds the amber threshold where the constant says", () => {
    // The constant is the contract; this catches somebody tuning it by editing
    // the comparison instead.
    const windowHours = 8 * 24;
    const firstAmberHour = Math.ceil(windowHours * AMBER_AT);

    expect(standing(false, firstAmberHour, 8)).toBe("amber");
    expect(standing(false, firstAmberHour - 1, 8)).toBe("green");
  });
});

describe("what the pill says", () => {
  it("says Online with nothing waiting", () => {
    expect(pillLabel(true, 0, null)).toBe("Online");
  });

  it("never hides work that is still owed, even while online", () => {
    // Pending sales stay visible until they are gone. Hiding them the moment a
    // connection returns is how a shop closes up believing everything went.
    expect(pillLabel(true, 47, null)).toBe("47 still to send");
  });

  it("says sales are SAVED, not pending", () => {
    // The wording is the feature. "47 pending" reads as a fault; "47 saved
    // here" says the true and reassuring thing — they are on this device,
    // waiting for a line, and they are not lost.
    const label = pillLabel(false, 47, null);

    expect(label).toBe("Offline · 47 saved here");
    expect(label).not.toMatch(/pending/i);
    expect(label).not.toMatch(/fail|error|lost/i);
  });

  it("says plain Offline when there is nothing waiting", () => {
    expect(pillLabel(false, 0, null)).toBe("Offline");
  });

  it("shows progress while sending, and that beats everything else", () => {
    // Mid-sync is the moment a shopkeeper is watching hardest. Progress, not a
    // spinner, and not the state it is on its way out of.
    expect(pillLabel(true, 47, { sent: 12, total: 47 })).toBe("Sending 12 of 47");
    expect(pillLabel(false, 47, { sent: 12, total: 47 })).toBe("Sending 12 of 47");
  });
});
