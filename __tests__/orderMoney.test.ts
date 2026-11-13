
import { moneyLineValue, orderMoneyLines, type MoneyLine } from "../src/modules/orders/orderMoney";

const said = (lines: MoneyLine[]) => lines.map((l) => [l.label, l.amount]);
const fmt = (x: number) => x.toFixed(2);

describe("an order's money, line by line — the server's figures, never a sum of our own", () => {
  it("says every share of the money off, the tax and the delivery (AnOrderIsPricedLikeTheTillTest's order)", () => {
    const lines = orderMoneyLines({
      subtotal: "2400.00", discount: "348.00", promotion_name: "Weekend 10%", promotion_discount: "240.00",
      member_discount: "108.00", tax: "85.50", tax_inclusive: false, delivery_fee: "100.00", total: "2237.50",
    }, "delivery");

    expect(said(lines)).toEqual([
      ["Items", 2400],
      ["Weekend 10%", 240],
      ["Member discount", 108],
      ["Tax", 85.5],
      ["Delivery", 100],
      ["Total", 2237.5],
    ]);
  });

  it("gives the coupon what is left of the discount once the other shares are out", () => {
    const lines = orderMoneyLines({
      subtotal: 2400, discount: 340, coupon_code: "SAVE100", promotion_name: "Weekend 10%", promotion_discount: 240, total: 2060,
    }, "pickup");

    expect(said(lines)).toEqual([["Items", 2400], ["Coupon SAVE100", 100], ["Weekend 10%", 240], ["Total", 2060]]);
  });

  it("reads an order from before offers reached orders as it always read: its whole discount was the coupon", () => {
    // What every order already in a shop's history looks like: no shares, no tax.
    const lines = orderMoneyLines({ subtotal: "900.00", discount: "90.00", coupon_code: "ONCE", delivery_fee: "150.00", total: "960.00" });

    expect(said(lines)).toEqual([["Items", 900], ["Coupon ONCE", 90], ["Delivery", 150], ["Total", 960]]);
  });

  it("says a tax inside the prices without adding it to them", () => {
    const lines = orderMoneyLines({ subtotal: 2400, tax: 95.24, tax_inclusive: true, total: 2400 }, "pickup");

    expect(lines.find((l) => l.key === "tax")).toEqual({ key: "tax", label: "Tax (included in the prices)", amount: 95.24, kind: "tax-inside" });
    expect(lines[lines.length - 1].amount).toBe(2400);
  });

  it("names a free delivery, and says none for a pickup", () => {
    const free = orderMoneyLines({ subtotal: 3000, delivery_fee: 0, total: 3000 }, "delivery");
    expect(moneyLineValue(free.find((l) => l.key === "delivery")!, fmt)).toBe("Free");

    const pickup = orderMoneyLines({ subtotal: 3000, delivery_fee: 150, total: 3000 }, "pickup");
    expect(pickup.some((l) => l.key === "delivery")).toBe(false);
  });

  it("takes money off with a minus and leaves everything else as the server said it", () => {
    const lines = orderMoneyLines({ subtotal: 100, discount: 10, total: 90 });
    expect(lines.map((l) => moneyLineValue(l, fmt))).toEqual(["100.00", "− 10.00", "90.00"]);
  });
});
