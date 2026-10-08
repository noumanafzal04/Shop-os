import { describe, expect, it } from "vitest";

import { orderFigures } from "./orderTerms";

// The online journey's baker: Rs 200 to deliver, nothing under Rs 1,000, free from Rs 5,000.
const BAKER = { delivery_fee: 200, min_order_amount: 1000, free_delivery_threshold: 5000 };

describe("what an order will cost, said before it is placed", () => {
  it("delivery is added to the basket", () => {
    expect(orderFigures(1500, "delivery", BAKER)).toEqual({ delivery: 200, total: 1700, short: 0, toFreeDelivery: 3500 });
  });

  it("collecting it costs nothing to deliver and has no minimum", () => {
    expect(orderFigures(900, "pickup", BAKER)).toEqual({ delivery: 0, total: 900, short: 0, toFreeDelivery: null });
  });

  it("a basket below the minimum is told by how much — for delivery only", () => {
    expect(orderFigures(900, "delivery", BAKER).short).toBe(100);
    // Exactly the minimum is enough, as the server takes it.
    expect(orderFigures(1000, "delivery", BAKER).short).toBe(0);
  });

  it("delivery is free from the threshold, exactly as the server waives it", () => {
    expect(orderFigures(5000, "delivery", BAKER)).toEqual({ delivery: 0, total: 5000, short: 0, toFreeDelivery: null });
    expect(orderFigures(4999, "delivery", BAKER).delivery).toBe(200);
  });

  it("a shop with no terms adds nothing and asks nothing", () => {
    expect(orderFigures(300, "delivery", {})).toEqual({ delivery: 0, total: 300, short: 0, toFreeDelivery: null });
  });

  it("a shop that delivers free never offers to make it free", () => {
    expect(orderFigures(300, "delivery", { delivery_fee: 0, free_delivery_threshold: 5000 }).toFreeDelivery).toBeNull();
  });
});
