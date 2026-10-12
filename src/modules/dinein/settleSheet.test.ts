import { describe, expect, it } from "vitest";

import { askOf, methodsOf, settlementOf, splitsOf, tendersOf, type SettleWorth } from "./settleSheet";

const lines = [{ id: "karahi", quantity: "2.000" }, { id: "tea", quantity: 3 }, { id: "naan", quantity: 4 }];
const worth = (due: number, more: Partial<SettleWorth> = {}): SettleWorth => ({ subtotal: 0, discount: 0, tax: 0, total: due, tip: 0, rounding: 0, due, ...more });

describe("what the settle sheet asks about", () => {
  it("is each chosen line, as much of it as was chosen — and nothing of a line left at nought", () => {
    expect(splitsOf(lines, { karahi: 2, tea: 1, naan: 0 })).toEqual([{ id: "karahi", quantity: 2 }, { id: "tea", quantity: 1 }]);
    // A line nobody has set is not being settled.
    expect(splitsOf(lines, { tea: 3 })).toEqual([{ id: "tea", quantity: 3 }]);
  });

  it("never asks for more of a line than the tab holds", () => {
    expect(splitsOf(lines, { tea: 9 })).toEqual([{ id: "tea", quantity: 3 }]);
  });

  it("is one tender until money is typed against a second", () => {
    expect(methodsOf("cash", "", "")).toEqual(["cash"]);
    // Chosen, nothing typed: the whole bill is still cash, and still rounds to the coin.
    expect(methodsOf("cash", "card", "")).toEqual(["cash"]);
    expect(methodsOf("cash", "card", "0")).toEqual(["cash"]);
    expect(methodsOf("cash", "card", "1500")).toEqual(["cash", "card"]);
    // The same method twice is one method.
    expect(methodsOf("cash", "cash", "1500")).toEqual(["cash"]);
  });

  it("carries the tip as typed, and nought for nonsense", () => {
    expect(askOf(lines, { tea: 3 }, "cash", "", "", "150").tip_amount).toBe(150);
    expect(askOf(lines, { tea: 3 }, "cash", "", "", "-20").tip_amount).toBe(0);
    expect(askOf(lines, { tea: 3 }, "cash", "", "", "abc").tip_amount).toBe(0);
  });
});

describe("what the settle sheet sends once it has been told", () => {
  const whole = askOf(lines, { karahi: 2, tea: 3 }, "cash", "", "", "");

  it("pays exactly what the server said is due — the figure from the report", () => {
    // 2 karahi and 3 teas, the tea at its own 18%: 4,611.90, not the 4,485 the sheet used to work out.
    expect(settlementOf(worth(4611.9, { subtotal: 4485, tax: 126.9 }), whole, "")).toEqual({
      splits: [{ id: "karahi", quantity: 2 }, { id: "tea", quantity: 3 }],
      payment_method: "cash",
      amount_paid: 4611.9,
      tip_amount: undefined,
    });
  });

  it("sends what crosses the counter, which is the bill, the tip and the coin together", () => {
    const tipped = askOf(lines, { tea: 3 }, "cash", "", "", "100");
    const sent = settlementOf(worth(930, { total: 831.9, tip: 100, rounding: -1.9 }), tipped, "");

    expect(sent.amount_paid).toBe(930);
    expect(sent.tip_amount).toBe(100);
  });

  it("divides a known amount between two tenders: the second as typed, the first the rest", () => {
    const two = askOf(lines, { karahi: 2, tea: 3 }, "cash", "card", "2000", "");

    expect(tendersOf(4611.9, two, "2000")).toEqual([{ method: "cash", amount: 2611.9 }, { method: "card", amount: 2000 }]);
    expect(settlementOf(worth(4611.9), two, "2000").payments).toEqual([{ method: "cash", amount: 2611.9 }, { method: "card", amount: 2000 }]);
  });

  it("never puts more on the second tender than is owed — and then it is the only tender", () => {
    const two = askOf(lines, { tea: 3 }, "cash", "card", "5000", "");
    const sent = settlementOf(worth(831.9), two, "5000");

    expect(tendersOf(831.9, two, "5000")).toEqual([{ method: "cash", amount: 0 }, { method: "card", amount: 831.9 }]);
    // Not a "payment" of nothing in cash beside it.
    expect(sent).toMatchObject({ payment_method: "card", amount_paid: 831.9 });
    expect("payments" in sent).toBe(false);
  });

  it("does not let paisa drift between the two tenders", () => {
    const two = askOf(lines, { tea: 3 }, "cash", "card", "277.3", "");
    const [first, second] = tendersOf(831.9, two, "277.3");

    expect(first.amount + second.amount).toBeCloseTo(831.9, 10);
    expect(first.amount).toBe(554.6);
  });
});
