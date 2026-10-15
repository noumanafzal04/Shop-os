import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useCashNeedsShift, useCounterShift } from "./useCounterShift";

/**
 * The counter's rule, for the screens beside the till: a shop that asks for
 * shifts takes money at the counter only on today's shift — a sale, and cash
 * taken as an advance (L2). Card money needs no drawer. While the shift is
 * still being asked for, nothing is refused on a guess.
 */

let required = true;
let session: unknown = null;

vi.mock("../../shop/hooks/useShop", () => ({ useShopSettings: () => ({ data: { pos_require_shift: required } }) }));
vi.mock("./usePos", () => ({ useCurrentSession: () => ({ data: session }) }));

const today = { id: "s1", status: "open", opened_on: "2026-10-15", from_an_earlier_day: false };
const theThirteenth = { id: "s0", status: "open", opened_on: "2026-10-13", from_an_earlier_day: true };

beforeEach(() => {
  required = true;
  session = null;
});

describe("money at the counter, beside the till", () => {
  it("is refused with no shift, and on an earlier day's", () => {
    expect(renderHook(() => useCounterShift()).result.current.ready).toBe(false);

    session = theThirteenth;
    const { result } = renderHook(() => useCounterShift());
    expect(result.current.ready).toBe(false);
    expect(result.current.why).toMatch(/open since .*13.* close it and open today's/);
  });

  it("is taken on today's shift, and anywhere in a shop that does not ask", () => {
    session = today;
    expect(renderHook(() => useCounterShift()).result.current.ready).toBe(true);

    required = false;
    session = null;
    expect(renderHook(() => useCounterShift()).result.current.ready).toBe(true);
  });

  it("refuses nothing while the shift is still being asked for", () => {
    session = undefined;
    expect(renderHook(() => useCounterShift()).result.current).toEqual({ ready: true, why: null });
  });
});

describe("an advance", () => {
  it("in cash needs today's shift; by card it does not", () => {
    expect(renderHook(() => useCashNeedsShift("cash", 500)).result.current, "cash with no shift was taken").toMatch(/^Open a shift to take cash .*Card, bank or wallet money needs no drawer/);
    expect(renderHook(() => useCashNeedsShift("card", 500)).result.current, "card money was held up for a drawer").toBeNull();
    expect(renderHook(() => useCashNeedsShift("cash", 0)).result.current, "no money at all was held up").toBeNull();

    session = today;
    expect(renderHook(() => useCashNeedsShift("cash", 500)).result.current).toBeNull();
  });
});
