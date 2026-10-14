import { describe, expect, it } from "vitest";
import { dueOn, openOrders, payOutlook } from "./payMath";

describe("payOutlook", () => {
  it("says what is left when a part payment is made", () => {
    // The number the dialog never showed: 36,000 owed, 15,000 handed over.
    expect(payOutlook(36000, 15000)).toEqual({ remaining: 21000, advance: 0, kind: "still-owed" });
  });

  it("calls a full settlement a settlement", () => {
    expect(payOutlook(21000, 21000)).toEqual({ remaining: 0, advance: 0, kind: "settles" });
  });

  it("treats a rounding-sized difference as settled, not as a debt", () => {
    // Rs 0.0004 left over is not something to chase, and printing "still owed
    // Rs 0.00" beside a Pay button is how a settled account looks unsettled.
    expect(payOutlook(1000, 999.9996).kind).toBe("settles");
  });

  it("names the overshoot as an advance rather than a negative debt", () => {
    // Cash on delivery against nothing ordered — the commonest small-shop
    // payment. It is money ahead, not money lost.
    expect(payOutlook(0, 3500)).toEqual({ remaining: 0, advance: 3500, kind: "advance" });
    expect(payOutlook(5000, 5500)).toEqual({ remaining: 0, advance: 500, kind: "advance" });
  });

  it("does not turn a part payment into an advance", () => {
    // The denominator for the case above: paying less must never read as ahead.
    expect(payOutlook(5000, 4999).kind).toBe("still-owed");
  });
});

describe("what an order still owes", () => {
  it("is what arrived less what was paid — not the whole order", () => {
    expect(dueOn({ total: 34000, received_total: 20500, amount_paid: 16500 })).toBe(4000);
  });

  it("a cancelled order still owes for what came before it was cancelled", () => {
    const orders = [
      { po_number: "PO-1", status: "cancelled", total: 19500, received_total: 6000, amount_paid: 0 },
      { po_number: "PO-2", status: "partially_received", total: 34000, received_total: 20500, amount_paid: 20500 },
      { po_number: "PO-3", status: "cancelled", total: 5000, received_total: 0, amount_paid: 0 },
      { po_number: "PO-4", status: "draft", total: 9000, received_total: 0, amount_paid: 0 },
      { po_number: "PO-5", status: "ordered", total: 7000, received_total: 0, amount_paid: 0 },
    ];
    expect(openOrders(orders).map((o) => o.po_number)).toEqual(["PO-1"]);
  });
});
