import { describe, expect, it } from "vitest";
import { joinable, piles, portions, totalOf, unsentByDish } from "./tabLines";
import type { TicketItem } from "./services/dineInService";

let n = 0;
const line = (over: Partial<TicketItem> = {}): TicketItem => ({
  id: `l${++n}`, product_id: "karahi", variant_id: null, modifier_option_ids: null,
  product_name: "Chicken Karahi", variant_name: null,
  quantity: "1", unit_price: "1450.00", line_total: "1450.00",
  modifiers: null, note: null, kot_status: "pending", voided_at: null, sale_id: null,
  ...over,
});

describe("another one of this", () => {
  it("joins the unsent line of the same dish", () => {
    const first = line();

    expect(joinable([first], { product_id: "karahi" })?.id).toBe(first.id);
  });

  it("does not join a different size, or different extras", () => {
    const large = line({ variant_id: "large" });
    const buttered = line({ modifier_option_ids: ["butter"] });

    expect(joinable([large], { product_id: "karahi" })).toBeNull();
    expect(joinable([large], { product_id: "karahi", variant_id: "regular" })).toBeNull();
    expect(joinable([large], { product_id: "karahi", variant_id: "large" })?.id).toBe(large.id);

    expect(joinable([buttered], { product_id: "karahi" })).toBeNull();
    expect(joinable([buttered], { product_id: "karahi", modifier_option_ids: ["butter", "naan"] })).toBeNull();
  });

  it("reads extras as a set — the order they were ticked in is not part of the dish", () => {
    const both = line({ modifier_option_ids: ["butter", "naan"] });

    expect(joinable([both], { product_id: "karahi", modifier_option_ids: ["naan", "butter"] })?.id).toBe(both.id);
  });

  it("never joins a line somebody wrote a note on", () => {
    // "No green chilli" was said about ONE karahi. A second tap joining that
    // line would tell the kitchen to make two without, and nobody said that.
    const noted = line({ note: "No green chilli" });

    expect(joinable([noted], { product_id: "karahi" })).toBeNull();
  });

  it("never joins what has been sent, paid for, or struck off", () => {
    const sent = line({ kot_status: "fired" });
    const paid = line({ sale_id: "s1" });
    const gone = line({ voided_at: "2026-10-06T10:00:00Z", kot_status: "void" });

    expect(joinable([sent, paid, gone], { product_id: "karahi" })).toBeNull();
  });
});

describe("the three piles", () => {
  const tab = [
    line({ id: "a", kot_status: "pending" }),
    line({ id: "b", kot_status: "fired" }),
    line({ id: "c", kot_status: "served" }),
    line({ id: "d", kot_status: "cleared" }),
    line({ id: "e", kot_status: "served", sale_id: "s1" }),
    line({ id: "f", kot_status: "void", voided_at: "2026-10-06T10:00:00Z" }),
  ];

  it("puts every live line in exactly one pile", () => {
    const p = piles(tab);

    expect(p.toSend.map((i) => i.id)).toEqual(["a"]);
    expect(p.inKitchen.map((i) => i.id)).toEqual(["b"]);
    // Served, and cleared off the board: both are out of the kitchen's hands.
    expect(p.out.map((i) => i.id)).toEqual(["c", "d"]);
    expect(p.paid.map((i) => i.id)).toEqual(["e"]);

    const everywhere = [...p.toSend, ...p.inKitchen, ...p.out, ...p.paid].map((i) => i.id).sort();
    expect(everywhere).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("what a menu tile and the footer say", () => {
  const tab = [
    line({ product_id: "naan", quantity: "8", line_total: "560.10" }),
    line({ product_id: "naan", quantity: "2", line_total: "140.20", note: "extra crisp" }),
    line({ product_id: "naan", quantity: "4", line_total: "280.00", kot_status: "fired" }),
    line({ product_id: "karahi", quantity: "1" }),
  ];

  it("counts what is waiting to be sent, per dish, across its lines", () => {
    // 8 + 2. The four already in the kitchen are not waiting on the waiter.
    expect(unsentByDish(tab)).toEqual({ naan: 10, karahi: 1 });
  });

  it("counts portions, not rows", () => {
    expect(portions(tab)).toBe(15);
  });

  it("adds money to the paisa", () => {
    expect(totalOf(tab.slice(0, 2))).toBe(700.3);
  });
});
