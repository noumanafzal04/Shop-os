import { renderSlip, columnsFor } from "../src/modules/printing/slip";
import type { Order } from "../src/modules/orders/services/ordersService";

const order = (over: Partial<Order> = {}): Order => ({
  id: "o1",
  order_number: "ORD-000012",
  status: "confirmed",
  fulfillment_type: "delivery",
  payment_method: "cod",
  payment_status: "unpaid",
  customer_name: "Ahmed",
  customer_phone: "0300-1234567",
  delivery_address: "House 4, Street 11, Model Town, Lahore",
  subtotal: 900,
  delivery_fee: 100,
  total: 1000,
  notes: null,
  cancel_reason: null,
  placed_at: "2026-09-18T12:30:00+05:00",
  rider_id: null,
  items: [
    {
      id: "i1",
      product_name: "Chicken Karahi",
      variant_name: "Full",
      modifiers: [{ option: "Extra spicy" }],
      quantity: 1,
      unit_price: 900,
      line_total: 900,
    },
  ],
  ...over,
});

const lines = (s: string) => s.split("\n");
const widest = (s: string) => Math.max(...lines(s).map((l) => l.length));

describe("the slip fits the paper", () => {
  it("takes its width from the SHOP's setting, not a guess", () => {
    // The till prints the same order at the same width. A phone that chose its
    // own would produce two different slips for one order.
    expect(columnsFor("thermal_58")).toBe(32);
    expect(columnsFor("thermal_80")).toBe(48);
    expect(columnsFor("standard")).toBe(48);
    // Unset is not 0 — a shop that has never opened the setting still prints.
    expect(columnsFor(undefined)).toBe(48);
  });

  it("never exceeds the paper, on either width", () => {
    for (const width of ["thermal_58", "thermal_80"] as const) {
      const slip = renderSlip(order(), { shopName: "Ali Karahi", width });
      expect({ width, widest: widest(slip) }).toEqual({
        width,
        widest: columnsFor(width),
      });
    }
  });

  it("wraps a long name instead of colliding with its price", () => {
    /**
     * The failure this prevents is a number nobody can trust: a name that
     * overruns pushes the price off the edge, or overlaps it. Two lines are
     * readable; an overlap is a bill somebody has to ask about.
     */
    const long = order({
      items: [
        {
          id: "i1",
          product_name: "Chicken Handi Family Size With Extra Naan And Salad",
          variant_name: null,
          modifiers: null,
          quantity: 2,
          unit_price: 1800,
          line_total: 3600,
        },
      ],
    });

    const slip = renderSlip(long, { shopName: "Ali Karahi", width: "thermal_58" });
    expect(widest(slip)).toBeLessThanOrEqual(32);
    expect(slip).toContain("Rs 3,600");
  });

  it("cuts a word longer than the paper rather than overflowing", () => {
    const silly = order({
      items: [
        {
          id: "i1",
          product_name: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          variant_name: null,
          modifiers: null,
          quantity: 1,
          unit_price: 10,
          line_total: 10,
        },
      ],
    });
    expect(widest(renderSlip(silly, { shopName: "S", width: "thermal_58" }))).toBeLessThanOrEqual(32);
  });
});

describe("a kitchen slip is not a customer's", () => {
  const forKitchen = renderSlip(order({ notes: "No onions" }), {
    shopName: "Ali Karahi",
    kitchen: true,
  });
  const forCustomer = renderSlip(order({ notes: "No onions" }), { shopName: "Ali Karahi" });

  it("keeps money OFF the kitchen docket", () => {
    /**
     * A cook does not price the order. A total on a kitchen slip is one more
     * thing to read past on a screen-less piece of paper in a hot room.
     */
    expect(forKitchen).not.toContain("TOTAL");
    expect(forKitchen).not.toContain("Rs 1,000");
    expect(forCustomer).toContain("TOTAL");
    expect(forCustomer).toContain("Rs 1,000");
  });

  it("keeps the customer's address and phone OFF it too", () => {
    // The kitchen does not deliver, and a docket left on a pass is a customer's
    // address on a counter.
    expect(forKitchen).not.toContain("Model Town");
    expect(forKitchen).not.toContain("0300-1234567");
    expect(forCustomer).toContain("Model Town");
  });

  it("carries the note, which is the whole reason the kitchen reads it", () => {
    expect(forKitchen).toContain("No onions");
  });

  it("keeps modifiers with their item", () => {
    expect(forKitchen).toContain("Extra spicy");
    expect(forCustomer).toContain("Extra spicy");
  });

  it("says which kind of slip it is", () => {
    expect(forKitchen).toContain("KITCHEN");
    expect(forCustomer).toContain("ORDER");
  });
});

describe("the two-ends line, when both ends are too wide", () => {
  /**
   * `spread` puts something at each end. When they do not fit it drops the
   * right half onto its own line — and this case exists because the first
   * mutation test of this file could not reach that branch at all: the item
   * lines are pre-wrapped to `cols - 10`, so they never collide.
   *
   * It is reached by the lines that are NOT pre-wrapped — an order number
   * beside a time, a payment method beside its status — on 32-column paper.
   */
  it("never lets two halves overlap or overflow", () => {
    const wide = renderSlip(
      order({
        order_number: "ORD-000000000000012",
        payment_method: "cod",
        payment_status: "awaiting_confirmation",
        total: 123456789,
      }),
      { shopName: "Ali Karahi", width: "thermal_58" },
    );

    expect(widest(wide)).toBeLessThanOrEqual(32);
    // And the right-hand half is still THERE — wrapping must not drop it.
    expect(wide).toContain("awaiting_confirmation");
    expect(wide).toContain("ORD-000000000000012");
  });
});
