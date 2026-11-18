import { etaLine } from "../src/modules/orders/orderStatus";

/**
 * THE TRACKING SCREEN'S FIRST LINE — from the shop's own prep time only.
 */
describe("when an order should arrive", () => {
  const placed = new Date(2026, 10, 18, 17, 0, 0); // 5:00 PM local
  const order = (over: Partial<{ status: string; fulfillment_type: "delivery" | "pickup" }> = {}) => ({
    placed_at: placed.toISOString(),
    status: "confirmed",
    fulfillment_type: "delivery" as const,
    ...over,
  });
  const at = (min: number) => new Date(placed.getTime() + min * 60_000);
  const t = (min: number) => at(min).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  it("gives a delivery window: prep, then a twenty-minute ride", () => {
    expect(etaLine(order(), 35, at(5))).toBe(`Arriving by ${t(35)} – ${t(55)}`);
  });

  it("gives a pickup a single time", () => {
    expect(etaLine(order({ fulfillment_type: "pickup" }), 20, at(5))).toBe(`Ready for pickup around ${t(20)}`);
  });

  it("stops promising a time once the window has passed", () => {
    expect(etaLine(order(), 35, at(56))).toBe("Taking a little longer than expected");
    expect(etaLine(order({ fulfillment_type: "pickup" }), 20, at(31))).toBe("Should be ready any minute");
  });

  it("invents nothing for a shop that never set a prep time, or an order that is over", () => {
    expect(etaLine(order(), null, at(5))).toBeNull();
    expect(etaLine(order(), 0, at(5))).toBeNull();
    expect(etaLine(order({ status: "completed" }), 35, at(5))).toBeNull();
    expect(etaLine(order({ status: "cancelled" }), 35, at(5))).toBeNull();
    expect(etaLine({ ...order(), placed_at: "not a date" }, 35, at(5))).toBeNull();
  });
});
