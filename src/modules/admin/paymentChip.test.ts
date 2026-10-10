import { describe, expect, it } from "vitest";

import { paymentChip } from "./paymentChip";

const PLAN = { id: "p1", name: "Basic" };

/**
 * A row in the tenant list, and the one word about its money.
 *
 * "paid" is the server's bucket for "not behind on anything", and a shop that
 * was never billed is in it. On a row that reads as "this shop has paid" —
 * beside the words "no plan".
 */
describe("what a shop's row says about its money", () => {
  it("says paid for a shop on a plan that is not behind", () => {
    expect(paymentChip({ payment_status: "paid", plan: PLAN })).toEqual({ label: "paid", color: "success" });
  });

  it("does NOT say paid for a shop on no plan — it has paid nothing", () => {
    // A demo kept an hour ago: real, on no plan, waiting to be given one.
    expect(paymentChip({ payment_status: "paid", plan: null })).toEqual({ label: "not priced yet", color: "warning" });
    expect(paymentChip({ payment_status: "paid" }).label).toBe("not priced yet");
  });

  it("says what is owed for a shop on a plan that is behind", () => {
    expect(paymentChip({ payment_status: "grace", plan: PLAN }).label).toBe("in grace");
    expect(paymentChip({ payment_status: "unpaid", plan: PLAN })).toEqual({ label: "unpaid", color: "error" });
  });

  it("says suspended first — switched off is switched off, plan or no plan", () => {
    expect(paymentChip({ payment_status: "suspended", plan: null }).label).toBe("suspended");
    expect(paymentChip({ payment_status: "suspended", plan: PLAN }).label).toBe("suspended");
  });

  it("says deleted before anything else", () => {
    expect(paymentChip({ deleted_at: "2026-10-01T10:00:00Z", payment_status: "unpaid", plan: PLAN }).label).toBe("deleted");
    expect(paymentChip({ deleted_at: "2026-10-01T10:00:00Z", plan: null }).label).toBe("deleted");
  });

  it("says nothing rather than guess, for a row the server gave no status", () => {
    expect(paymentChip({ plan: PLAN }).label).toBe("—");
  });
});
