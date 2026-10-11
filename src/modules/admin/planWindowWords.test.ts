import { describe, expect, it } from "vitest";

import { dayOf, windowSays, type PlanWindow } from "./planWindowWords";

const told = (over: Partial<PlanWindow>): PlanWindow => ({
  starts_on: "2026-09-01", ends_on: "2026-10-01", because: "running", valid: true,
  current_ends_on: "2026-09-01", grace_ends_on: "2026-09-06", months: 1, ...over,
});

describe("what a payment would buy, in the renewal dialog", () => {
  it("says the dates the same way on every laptop", () => {
    expect(dayOf("2026-09-01")).toBe("1 Sep 2026");
    expect(dayOf("2026-02-28")).toBe("28 Feb 2026");
    // A calendar date has no timezone: nothing moves the first of the year to the day before.
    expect(dayOf("2026-01-01")).toBe("1 Jan 2026");
    expect(dayOf("2026-12-31T19:00:00+00:00")).toBe("31 Dec 2026");
  });

  it("a shop still running carries on from where its paid period ends", () => {
    const says = windowSays(told({ because: "running" }));

    expect(says.buys).toBe("This buys 1 Sep 2026 → 1 Oct 2026.");
    expect(says.why).toBe("It carries on from 1 Sep 2026, so no paid day is lost.");
    expect(says.wrong).toBe(false);
  });

  it("a shop in its grace days is told those days are part of what it pays for", () => {
    const says = windowSays(told({ because: "grace" }));

    expect(says.buys).toBe("This buys 1 Sep 2026 → 1 Oct 2026.");
    expect(says.why).toContain("grace days");
    expect(says.why).toContain("part of the period it is paying for");
  });

  it("a shop whose grace ran out starts today, and is told when it ran out", () => {
    const says = windowSays(told({ because: "lapsed", starts_on: "2026-10-09", ends_on: "2026-11-09", current_ends_on: "2026-10-01", grace_ends_on: "2026-10-06" }));

    expect(says.buys).toBe("This buys 9 Oct 2026 → 9 Nov 2026.");
    expect(says.why).toBe("Its grace ran out on 6 Oct 2026 and it has been read-only since, so the new period starts today.");
  });

  it("a different plan says what is given up", () => {
    const says = windowSays(told({ because: "new_plan", starts_on: "2026-10-20", ends_on: "2026-11-20", current_ends_on: "2026-11-09" }));

    expect(says.why).toContain("A different plan starts a new period today.");
    expect(says.why).toContain("to 9 Nov 2026");
    expect(says.why).toContain("not carried over");
  });

  it("a shop that was on nothing just starts", () => {
    expect(windowSays(told({ because: "first", current_ends_on: null, grace_ends_on: null })).why).toBe("It starts today.");
  });

  it("typed dates are said to be the typed dates", () => {
    expect(windowSays(told({ because: "stated", starts_on: "2026-10-01", ends_on: "2026-11-01" })).why).toBe("These are the dates you typed.");
  });

  it("dates the wrong way round are said to be wrong, before the save refuses them", () => {
    const says = windowSays(told({ because: "stated", valid: false, starts_on: "2026-08-01", ends_on: "2026-07-01" }));

    expect(says.wrong).toBe(true);
    expect(says.buys).toContain("ends before it starts");
  });
});
