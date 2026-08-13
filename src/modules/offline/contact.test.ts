import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetServerContact,
  hoursSinceContact,
  lastServerContact,
  markServerContact,
} from "./contact";

/**
 * The clock the whole offline policy is measured against.
 *
 * It has to survive a reload, because the question it answers — "how long has
 * this tablet been out of contact?" — is asked hardest on a cold boot with no
 * network, where memory is empty and the server cannot be asked.
 *
 * Two failure modes are worse than not knowing, and both are tested: reading a
 * device with NO history as maximally stale (which would refuse a shop on its
 * first morning), and trusting a timestamp from the future (a clock wound back,
 * which would read as freshly-contacted forever).
 */

const KEY = "shopos-last-server-contact";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("recording a contact", () => {
  it("remembers when the server was last reached", () => {
    const at = Date.now() - 1000;
    markServerContact(at);

    expect(lastServerContact()).toBe(at);
  });

  it("survives a reload — it is in storage, not in memory", () => {
    markServerContact(1_700_000_000_000);

    expect(localStorage.getItem(KEY)).toBe("1700000000000");
  });

  it("moves forward on every later contact", () => {
    markServerContact(1_000);
    markServerContact(2_000);

    expect(lastServerContact()).toBe(2_000);
  });
});

describe("a device with no history", () => {
  it("says it does not know, rather than 'a very long time'", () => {
    // The difference decides whether a brand new tablet can trade on its first
    // morning. "Never heard from the server" is not "out of contact for ever".
    expect(lastServerContact()).toBeNull();
    expect(hoursSinceContact()).toBeNull();
  });
});

describe("values that cannot be trusted", () => {
  it.each([
    ["a word", "yesterday"],
    ["empty", ""],
    ["zero", "0"],
    ["negative", "-500"],
    ["not a number", "NaN"],
  ])("ignores %s", (_label, stored) => {
    localStorage.setItem(KEY, stored);

    expect(lastServerContact()).toBeNull();
    expect(hoursSinceContact()).toBeNull();
  });

  it("ignores a timestamp from the future", () => {
    // A clock wound back. Trusting it would report a negative age and read as
    // freshly-contacted for as long as the clock stayed wrong — the till would
    // never warn, and never stop.
    localStorage.setItem(KEY, String(Date.now() + 86_400_000));

    expect(lastServerContact()).toBeNull();
    expect(hoursSinceContact()).toBeNull();
  });
});

describe("how long it has been", () => {
  it("counts hours since the last contact", () => {
    const now = 1_700_000_000_000;
    markServerContact(now - 3 * 3_600_000);

    expect(hoursSinceContact(now)).toBeCloseTo(3, 5);
  });

  it("counts fractions, which is the whole reason it is hours", () => {
    // A one-day window warns at 18 hours. Whole days could not express that.
    const now = 1_700_000_000_000;
    markServerContact(now - 90 * 60_000); // 1.5 hours

    expect(hoursSinceContact(now)).toBeCloseTo(1.5, 5);
  });

  it("never returns a negative age", () => {
    const now = 1_700_000_000_000;
    markServerContact(now);

    expect(hoursSinceContact(now)).toBe(0);
  });

  it("reads days correctly for a long outage", () => {
    const now = 1_700_000_000_000;
    markServerContact(now - 5 * 24 * 3_600_000);

    expect(hoursSinceContact(now)).toBeCloseTo(120, 5);
  });
});

describe("storage that refuses to work", () => {
  it("does not throw when writing is impossible", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => markServerContact()).not.toThrow();
  });

  it("says it does not know when reading throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(lastServerContact()).toBeNull();
    expect(hoursSinceContact()).toBeNull();
  });

  it("does not throw when forgetting is impossible", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(() => forgetServerContact()).not.toThrow();
  });
});

describe("forgetting", () => {
  it("clears the history — only for a till changing shops", () => {
    markServerContact();
    forgetServerContact();

    expect(lastServerContact()).toBeNull();
  });
});
