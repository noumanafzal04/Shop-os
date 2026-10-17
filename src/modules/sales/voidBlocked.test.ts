import { describe, expect, it } from "vitest";

import { voidBlocked } from "./voidBlocked";
import type { SaleVoid } from "./types";

/** Q18 + B86 (2026-10-17): the sheet says what the server would refuse, before the press. */
const sheet = (over: Partial<SaleVoid> = {}): SaleVoid => ({
  open: true, why_not: null, cash_back: 1000, from_drawer: true, drawer: "open", drawer_holds: 5000, ...over,
});
const money = (n: number) => `Rs ${n.toLocaleString("en-US")}`;

describe("a void the sheet can offer", () => {
  it("is offered the same day, out of the person's own drawer that holds the cash", () => {
    expect(voidBlocked(sheet(), false, money)).toBeNull();
    expect(voidBlocked(sheet({ drawer_holds: 1000 }), false, money)).toBeNull();
  });

  it("asks for no drawer for notes no drawer took — a card sale, or cash rung with no shift", () => {
    expect(voidBlocked(sheet({ from_drawer: false, drawer: "none" }), false, money)).toBeNull();
  });
});

describe("a void the sheet holds back", () => {
  it("once the day is over, in the server's words", () => {
    const over = "INV-000004 was rung on Fri 17 Oct 2026 — that day is over. Take the goods back with Return / Refund.";
    expect(voidBlocked(sheet({ open: false, why_not: over }), false, money)).toBe(over);
    // Even with a drawer named, and with nothing in notes: the day decides first.
    expect(voidBlocked(sheet({ open: false, why_not: over, from_drawer: false }), true, money)).toBe(over);
  });

  it("with no drawer open to hand the notes back from", () => {
    expect(voidBlocked(sheet({ drawer: "none", drawer_holds: null }), false, money)).toMatch(/Rs 1,000 in cash\. Open your shift first/);
    expect(voidBlocked(sheet({ drawer: "practice", drawer_holds: null }), false, money)).toMatch(/practice one/);
  });

  it("with a drawer that holds less than it hands back", () => {
    expect(voidBlocked(sheet({ drawer_holds: 400 }), false, money)).toBe("Your drawer holds Rs 400 — this hands back Rs 1,000 in cash. Put cash in the drawer first.");
  });

  it("but leaves another named drawer to the server, which knows what it holds", () => {
    expect(voidBlocked(sheet({ drawer: "none", drawer_holds: null }), true, money)).toBeNull();
  });
});
