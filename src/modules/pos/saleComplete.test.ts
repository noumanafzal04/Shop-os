import { describe, expect, it } from "vitest";

import { billToAddTo, settledLines, visitLine, type SettledSale } from "./saleComplete";

const sale = (over: Partial<SettledSale> = {}): SettledSale => ({
  total: "4990.00", amount_paid: "4990.00", change_due: "0.00", payment_method: "cash", payments: [], trade_in_total: "0.00", ...over,
});

describe("how the bill was settled, under the total", () => {
  it("cash: what was handed over and the change", () => {
    expect(settledLines(sale({ amount_paid: "5000.00", change_due: "10.00" }))).toEqual([
      { label: "Paid in cash", amount: 5000 },
      { label: "Change", amount: 10 },
    ]);
  });

  it("khata: owed, never 'paid', and no change (B18)", () => {
    expect(settledLines(sale({ payment_method: "credit" }))).toEqual([{ label: "On khata", amount: 4990 }]);
  });

  it("a card with a bank offer: the offer named, what the customer paid, no change (B28)", () => {
    const lines = settledLines(sale({
      total: "5541.00", amount_paid: "4741.00", payment_method: "card",
      bank_offer: { label: "Ramadan 15%", bank: "HBL", discount: 800 },
    }));

    expect(lines).toEqual([
      { label: "Bank offer · HBL Ramadan 15%", amount: -800 },
      { label: "Paid by card", amount: 4741 },
    ]);
  });

  it("a split: each leg in words, khata among them, change only when cash was in it", () => {
    const split = sale({
      payment_method: "split", amount_paid: "5000.00", change_due: "10.00",
      payments: [
        { id: "1", method: "credit", amount: "2000.00", reference: null },
        { id: "2", method: "cash", amount: "3000.00", reference: null },
      ],
    });
    expect(settledLines(split)).toEqual([
      { label: "On khata", amount: 2000 },
      { label: "Cash", amount: 3000 },
      { label: "Change", amount: 10 },
    ]);

    const noCash = sale({ payment_method: "split", payments: [{ id: "1", method: "card", amount: "4990.00", reference: null }] });
    expect(settledLines(noCash).map((l) => l.label)).toEqual(["Card"]);
  });

  it("goods taken in part-payment are said once, as goods", () => {
    const lines = settledLines(sale({
      trade_in_total: "1000.00", amount_paid: "3990.00",
      payments: [{ id: "t", method: "trade_in", amount: "1000.00", reference: null }],
    }));

    expect(lines).toEqual([
      { label: "Traded in", amount: -1000 },
      { label: "Paid in cash", amount: 3990 },
      { label: "Change", amount: 0 },
    ]);
  });
});

/** Q19 A: two more for a customer whose bill is already paid and printed. */
describe("adding to a bill already paid", () => {
  const money = (n: number) => `Rs ${n.toLocaleString("en-US")}`;
  const visit = {
    first_id: "s1",
    bills: [
      { id: "s1", invoice_number: "INV-000034", total: 800, cancelled: false },
      { id: "s2", invoice_number: "INV-000035", total: 300, cancelled: false },
    ],
    together: 1100,
  };

  it("adds to the bill itself when it stands alone", () => {
    expect(billToAddTo({ id: "s1", invoice_number: "INV-000034", total: "800.00", visit: null }))
      .toEqual({ id: "s1", invoice_number: "INV-000034", together: 800 });
  });

  it("adds to the FIRST bill of the visit, never to an addition", () => {
    expect(billToAddTo({ id: "s2", invoice_number: "INV-000035", total: "300.00", visit }))
      .toEqual({ id: "s1", invoice_number: "INV-000034", together: 1100 });
  });

  it("says what the bills come to together, from whichever bill it is read", () => {
    expect(visitLine({ id: "s2", visit }, money)).toBe("Added to INV-000034 — both bills come to Rs 1,100");
    expect(visitLine({ id: "s1", visit }, money)).toBe("Bills added to this one — both bills come to Rs 1,100");
    expect(visitLine({ id: "s3", visit: { ...visit, bills: [...visit.bills, { id: "s3", invoice_number: "INV-000036", total: 100, cancelled: false }], together: 1200 } }, money))
      .toBe("Added to INV-000034 — all 3 bills come to Rs 1,200");
    expect(visitLine({ id: "s1", visit: null }, money)).toBeNull();
    expect(visitLine({ id: "s1", visit: { ...visit, bills: [visit.bills[0]], together: 800 } }, money), "one bill is not a visit of two").toBeNull();
  });
});
