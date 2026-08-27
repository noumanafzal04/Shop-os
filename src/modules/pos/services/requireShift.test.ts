import { describe, expect, it } from "vitest";

import { canRingASale, whyCannotRing, type ActiveCover, type CashSession } from "./posService";

/**
 * "REQUIRE OPEN SHIFT" WAS A SWITCH WITH NOTHING ON THE OTHER END.
 *
 * The setting ships OFF, and the backend test that pins that default states
 * the reason outright: *"Shift discipline is opt-in: enforcing it by default
 * would stop a one-person shop from selling the day the check went live."*
 * The server agrees with itself — `cash_session_id` is nullable, and
 * SaleController refuses a shiftless counter sale only when the shop asked
 * for that.
 *
 * The till read none of it. `canRing` was `activeSessionId !== null`, full
 * stop, so the counter behaved as though the switch were permanently ON:
 *
 *   • a shop that had never turned it on still could not ring without a drawer
 *   • turning it OFF changed nothing anybody could observe
 *   • a one-person shop was stopped exactly as the default exists to prevent
 *
 * These tests are the rule, in the two states the shop can put it in.
 */

const drawer: CashSession = {
  id: "sess-1",
  status: "open",
  opening_float: 3000,
  cash_sales: 0,
  expected_cash: 3000,
  counted_cash: null,
  variance: null,
  sales_count: 0,
  sales_total: 0,
  opened_at: "2026-08-27T09:00:00+05:00",
  closed_at: null,
  register_id: "lane-1",
};

const cover = {
  covering: true,
  session_id: "sess-9",
  register: { id: "lane-2", name: "Lane 2" },
  user_name: "Bilal",
} as unknown as ActiveCover;

describe("a shop that does not require shifts can sell without one", () => {
  it("rings with no drawer open when the setting is off", () => {
    // The whole defect, in one line. This returned false.
    expect(canRingASale(null, false)).toBe(true);
  });

  it("says nothing, because there is nothing to say", () => {
    expect(whyCannotRing(null, false)).toBeNull();
  });
});

describe("a shop that requires shifts is held to it", () => {
  it("refuses with no drawer open", () => {
    expect(canRingASale(null, true)).toBe(false);
  });

  it("says which shop rule stopped it", () => {
    // Not the bare "Open a shift to sell." the till used to print at shops
    // that had never asked for shifts.
    expect(whyCannotRing(null, true)).toMatch(/requires one/i);
  });
});

describe("a drawer to ring into always wins", () => {
  it("rings on my own open drawer, either way the setting is set", () => {
    for (const requireShift of [true, false]) {
      expect(canRingASale(drawer, requireShift)).toBe(true);
      expect(whyCannotRing(drawer, requireShift)).toBeNull();
    }
  });

  it("rings under relief cover, either way the setting is set", () => {
    // A reliever rings against the drawer they are standing at. That is the
    // whole point of cover, and it must not be re-broken by this rule.
    for (const requireShift of [true, false]) {
      expect(canRingASale(cover, requireShift)).toBe(true);
    }
  });

  it("refuses on a CLOSED drawer when the shop requires one", () => {
    // status !== "open" is not a drawer, and the setting decides from there.
    const closed = { ...drawer, status: "closed" } as CashSession;

    expect(canRingASale(closed, true)).toBe(false);
    expect(canRingASale(closed, false)).toBe(true);
  });
});
