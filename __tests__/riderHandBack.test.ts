import { handBackLine } from "../src/modules/rider/screens/RiderEarningsScreen";

/**
 * A POOL RIDER IS TOLD WHAT GOES BACK, not just what is in the pocket.
 * Found by the end-to-end run: the shop's statement said "to hand in" and the
 * rider's own screen only had the gross.
 */
describe("the rider's hand-back line", () => {
  it("names what goes back and what is the rider's fee", () => {
    const line = handBackLine({ cash_in_hand: 4949.6, to_hand_in: 4709.6, cash_orders: 2 });
    expect(line).toContain("4,709.60");
    expect(line).toContain("240");
    expect(line).toContain("2 cash orders");
  });

  it("says it is all the shop's when the rider keeps no fee", () => {
    expect(handBackLine({ cash_in_hand: 2000, to_hand_in: 2000, cash_orders: 1 })).toMatch(/shop's money/);
  });

  it("falls back to the gross for a server that sends no hand-back figure", () => {
    expect(handBackLine({ cash_in_hand: 2000, cash_orders: 1 })).toMatch(/shop's money/);
  });
});
