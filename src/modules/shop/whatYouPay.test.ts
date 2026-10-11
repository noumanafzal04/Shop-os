import { describe, expect, it } from "vitest";

import { everyPeriod, whatYouPay, type ShopBill } from "./whatYouPay";

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-US")}`;

const bill = (over: Partial<ShopBill> = {}): ShopBill => ({
  months: 1,
  plan: 3000,
  addons: [{ key: "customers", label: "Customers & Khata", monthly: 400, amount: 400 }],
  total: 3400,
  ...over,
});

describe("what a shop pays, on its own Subscription screen", () => {
  it("a shop with an add-on is told the plan, the add-on and the sum — not the plan's price alone", () => {
    const pays = whatYouPay(bill(), rs)!;

    expect(pays.plan).toBe("Rs 3,000");
    expect(pays.lines).toEqual([{ key: "customers", label: "Customers & Khata", amount: "Rs 400", note: null }]);
    expect(pays.total).toBe("Rs 3,400");
    expect(pays.every).toBe("every month");
  });

  it("paid by the year, an add-on is twelve months of it — and says so", () => {
    const pays = whatYouPay(bill({
      months: 12, plan: 30000, total: 34800,
      addons: [{ key: "customers", label: "Customers & Khata", monthly: 400, amount: 4800 }],
    }), rs)!;

    expect(pays.every).toBe("every 12 months");
    expect(pays.lines[0]).toEqual({ key: "customers", label: "Customers & Khata", amount: "Rs 4,800", note: "Rs 400 a month" });
    expect(pays.total).toBe("Rs 34,800");
  });

  it("an add-on given free is said to be free, not left off", () => {
    const pays = whatYouPay(bill({
      total: 3000,
      addons: [{ key: "labels", label: "Barcode Labels", monthly: 0, amount: 0 }],
    }), rs)!;

    expect(pays.lines[0].amount).toBe("No charge");
    expect(pays.total).toBe("Rs 3,000");
  });

  it("a shop with exactly what its plan includes is told nothing more: the price is the price", () => {
    expect(whatYouPay(bill({ addons: [], total: 3000 }), rs)).toBeNull();
    expect(whatYouPay(null, rs)).toBeNull();
    expect(whatYouPay(undefined, rs)).toBeNull();
  });

  it("a period is said the way a person says it", () => {
    expect(everyPeriod(1)).toBe("every month");
    expect(everyPeriod(3)).toBe("every 3 months");
  });
});
