import { describe, expect, it } from "vitest";

import type { Rider } from "./services/ordersService";
import { asksWhoCarries, carryingNow, whoCanCarry } from "./whoCarries";

const rider = (name: string, more: Partial<Rider> = {}): Rider => ({ id: name, name, phone: null, is_active: true, ...more } as Rider);

describe("out for delivery asks who is carrying it", () => {
  it("asks when a delivery leaves with nobody on it", () => {
    expect(asksWhoCarries({ fulfillment_type: "delivery", rider_id: null }, "out_for_delivery")).toBe(true);
  });

  it("does not ask again when somebody already is", () => {
    expect(asksWhoCarries({ fulfillment_type: "delivery", rider_id: "r1" }, "out_for_delivery")).toBe(false);
  });

  it("asks at that step and no other — confirming or cooking an order sends nobody anywhere", () => {
    for (const to of ["confirmed", "preparing", "ready", "completed", "cancelled"] as const) {
      expect(asksWhoCarries({ fulfillment_type: "delivery", rider_id: null }, to), to).toBe(false);
    }
  });

  it("never asks about an order somebody walks in to collect", () => {
    expect(asksWhoCarries({ fulfillment_type: "pickup", rider_id: null }, "out_for_delivery")).toBe(false);
    expect(asksWhoCarries({ fulfillment_type: "pickup", rider_id: null }, "ready")).toBe(false);
  });
});

describe("who it can be given to", () => {
  it("offers the freest rider first, and by name among equals", () => {
    const offered = whoCanCarry([rider("Zahid", { active_deliveries: 0 }), rider("Bilal", { active_deliveries: 3 }), rider("Ahmed", { active_deliveries: 0 }), rider("Usman")]);

    expect(offered.map((r) => r.name)).toEqual(["Ahmed", "Usman", "Zahid", "Bilal"]);
  });

  it("does not offer somebody who has left", () => {
    expect(whoCanCarry([rider("Gone", { is_active: false }), rider("Here")]).map((r) => r.name)).toEqual(["Here"]);
  });

  it("is an empty list for a shop that has made no rider — which is allowed", () => {
    expect(whoCanCarry([])).toEqual([]);
  });

  it("says what a rider is doing now", () => {
    expect(carryingNow({})).toBe("Free");
    expect(carryingNow({ active_deliveries: 0 })).toBe("Free");
    expect(carryingNow({ active_deliveries: 1 })).toBe("Out with 1 order");
    expect(carryingNow({ active_deliveries: 4 })).toBe("Out with 4 orders");
  });
});
