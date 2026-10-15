import { describe, expect, it } from "vitest";

import { ledgerLine, methodWords, overpaid, saleLink, standing } from "./khata";

describe("a khata, said the way a shopkeeper says it", () => {
  it("owes above zero, holds an advance below it, and is clear at zero", () => {
    expect(standing("4227.30")).toEqual({ kind: "owes", amount: 4227.3 });
    expect(standing(-22.7)).toEqual({ kind: "advance", amount: 22.7 });
    expect(standing("0.00")).toEqual({ kind: "clear", amount: 0 });
    expect(standing(null)).toEqual({ kind: "clear", amount: 0 });
  });

  it("asks before taking more than is owed (L13: 4,250 against 4,227.30)", () => {
    expect(overpaid(4250, "4227.30")).toEqual({ owed: 4227.3, extra: 22.7 });
    expect(overpaid(4227.3, "4227.30")).toBeNull();
    expect(overpaid(1000, "4227.30")).toBeNull();
    // Owing nothing, or already in credit: all of it would be an advance.
    expect(overpaid(500, 0)).toEqual({ owed: 0, extra: 500 });
    expect(overpaid(500, -22.7)).toEqual({ owed: 0, extra: 500 });
    expect(overpaid(0, 100)).toBeNull();
  });

  it("names a method and a statement line in people's words", () => {
    expect(methodWords("bank_transfer")).toBe("Transfer");
    expect(methodWords("wallet")).toBe("Wallet");
    expect(ledgerLine({ type: "charge", method: null, reference: null })).toBe("Credit sale");
    expect(ledgerLine({ type: "payment", method: "bank_transfer", reference: null })).toBe("Paid · Transfer");
    expect(ledgerLine({ type: "payment", method: "return", reference: "RET-000002" })).toBe("Returned · RET-000002");
    expect(ledgerLine({ type: "payment", method: "cancellation", reference: "INV-000005" })).toBe("Sale cancelled");
  });

  it("opens a sale on its own sheet", () => {
    expect(saleLink({ id: "s-1", invoice_number: "INV-000005" })).toBe("/tenant/sales?q=INV-000005&open=s-1");
  });
});
