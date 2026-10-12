import { describe, expect, it } from "vitest";

import { BOARD, cameBy, linesOf, onTheBoard } from "./orderBoard";
import type { OwnerOrder } from "./services/ordersService";

const order = (over: Partial<OwnerOrder>): OwnerOrder =>
  ({ id: over.order_number ?? "o", order_number: "ORD-1", status: "pending", fulfillment_type: "delivery", placed_at: "2026-10-12T10:00:00Z", items: [], ...over }) as OwnerOrder;

describe("the orders still being worked, as a board", () => {
  it("puts each order in the column of what it is waiting for, in the order work moves", () => {
    const board = onTheBoard([
      order({ order_number: "A", status: "preparing" }),
      order({ order_number: "B", status: "pending" }),
      order({ order_number: "C", status: "out_for_delivery" }),
      order({ order_number: "D", status: "ready" }),
      order({ order_number: "E", status: "confirmed" }),
    ]);

    expect(BOARD.map((c) => c.key)).toEqual(["new", "confirmed", "preparing", "leaving"]);
    expect(board.new.map((o) => o.order_number)).toEqual(["B"]);
    expect(board.confirmed.map((o) => o.order_number)).toEqual(["E"]);
    expect(board.preparing.map((o) => o.order_number)).toEqual(["A"]);
    // Ready to collect and out with a rider wait for the same thing: the customer.
    expect(board.leaving.map((o) => o.order_number).sort()).toEqual(["C", "D"]);
  });

  it("puts the one that has waited longest on top — the list had the newest there", () => {
    const board = onTheBoard([
      order({ order_number: "just now", placed_at: "2026-10-12T10:20:00Z" }),
      order({ order_number: "twenty minutes", placed_at: "2026-10-12T10:00:00Z" }),
      order({ order_number: "ten minutes", placed_at: "2026-10-12T10:10:00Z" }),
    ]);

    expect(board.new.map((o) => o.order_number)).toEqual(["twenty minutes", "ten minutes", "just now"]);
  });

  it("has no place for an order that is finished", () => {
    const board = onTheBoard([order({ status: "completed" }), order({ status: "cancelled" })]);

    expect(Object.values(board).flat()).toEqual([]);
  });

  it("says what is in an order without opening it — a few lines, and how many more", () => {
    const o = order({ items: [
      { product_name: "Chicken Karahi", variant_name: "Full", quantity: 1, unit_price: "1600", line_total: "1600" },
      { product_name: "Chicken Biryani", variant_name: null, quantity: 2, unit_price: "450", line_total: "900" },
      { product_name: "Mint Lemonade", variant_name: null, quantity: 3, unit_price: "180", line_total: "540" },
      { product_name: "Raita", variant_name: null, quantity: 1, unit_price: "80", line_total: "80" },
      { product_name: "Naan", variant_name: null, quantity: 4, unit_price: "40", line_total: "160" },
    ] });

    expect(linesOf(o)).toEqual({ lines: ["1× Chicken Karahi (Full)", "2× Chicken Biryani", "3× Mint Lemonade"], more: 2 });
    expect(linesOf(o, 10).more).toBe(0);
    expect(linesOf(order({ items: undefined }))).toEqual({ lines: [], more: 0 });
  });

  it("a quantity is written as a person writes it", () => {
    const o = order({ items: [{ product_name: "Sugar", variant_name: null, quantity: "2.500" as never, unit_price: "160", line_total: "400" }] });

    expect(linesOf(o).lines).toEqual(["2.5× Sugar"]);
  });

  it("names the door an order came through — WhatsApp, not Whatsapp", () => {
    expect(cameBy("whatsapp")).toBe("WhatsApp");
    expect(cameBy("walk_in")).toBe("Counter");
    expect(cameBy("phone")).toBe("Phone");
    expect(cameBy("online")).toBe("Online");
    expect(cameBy(null)).toBeNull();
  });
});
