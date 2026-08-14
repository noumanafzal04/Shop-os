import { describe, expect, it } from "vitest";

import {
  canSellOffline,
  MONEY_BACK_OFFLINE,
  OFFLINE_TENDERS,
  refusalsFor,
  type OfflineCart,
} from "./canSellOffline";

/**
 * What a till may ring with no server, decided AT THE COUNTER.
 *
 * The server enforces all of this again on sync, and that is the boundary. This
 * answers a different question at a different moment:
 *
 *   the server asks   "may I record this?"      — after the fact, once
 *   this asks         "may I take this money?"  — before it, in front of a
 *                                                 customer
 *
 * Getting the second wrong is the expensive one. A cashier allowed to complete
 * a sale the shop will later flag has already handed over the goods, and the
 * customer has gone.
 */

const cart = (over: Partial<OfflineCart> = {}): OfflineCart => ({
  lines: [{ name: "Milkpak 1L", offline_ok: true }],
  paymentMethod: "cash",
  ...over,
});

describe("an ordinary cash sale", () => {
  it("goes through", () => {
    expect(canSellOffline(cart())).toBe(true);
    expect(refusalsFor(cart())).toEqual([]);
  });

  it.each(OFFLINE_TENDERS)("takes %s", (method) => {
    expect(canSellOffline(cart({ paymentMethod: method }))).toBe(true);
  });
});

describe("what a single till cannot decide alone", () => {
  it("refuses an item the shop marked unsellable offline", () => {
    // Medicine and serialised goods. The catalog projection carries the
    // server's own verdict down, so the two can never disagree.
    const refusals = refusalsFor(cart({ lines: [{ name: "Panadol", offline_ok: false }] }));

    expect(refusals).toHaveLength(1);
    expect(refusals[0].reason).toMatch(/Panadol/);
  });

  it("names the item, so the cashier knows which one to take off", () => {
    const refusals = refusalsFor(
      cart({
        lines: [
          { name: "Milkpak 1L", offline_ok: true },
          { name: "Augmentin 625", offline_ok: false },
        ],
      }),
    );

    expect(refusals).toHaveLength(1);
    expect(refusals[0].reason).toContain("Augmentin 625");
    expect(refusals[0].fix).toBeDefined();
  });

  it("refuses khata, and says why rather than just saying no", () => {
    const refusals = refusalsFor(cart({ paymentMethod: "credit" }));

    expect(refusals[0].reason).toMatch(/shared between tills/);
    expect(refusals[0].fix).toMatch(/cash or card/);
  });

  it("refuses a dine-in tab", () => {
    expect(canSellOffline(cart({ orderType: "dine_in" }))).toBe(false);
  });

  it("allows takeaway on the same shop", () => {
    // A restaurant with no internet must still be able to sell over the
    // counter. Refusing the whole trade because tables are shared would close
    // the shop.
    expect(canSellOffline(cart({ orderType: "takeaway" }))).toBe(true);
  });

  it("refuses to spend points, and says the earned ones still count", () => {
    const refusals = refusalsFor(cart({ redeemPoints: 200 }));

    expect(refusals[0].reason).toMatch(/balance is shared/);
    expect(refusals[0].fix).toMatch(/still be added/);
  });

  it("allows a sale that earns points without spending any", () => {
    expect(canSellOffline(cart({ redeemPoints: 0 }))).toBe(true);
  });

  it("refuses a coupon, because its remaining uses are the server's count", () => {
    expect(canSellOffline(cart({ couponCode: "EID50" }))).toBe(false);
  });

  it("is not upset by an empty coupon field", () => {
    expect(canSellOffline(cart({ couponCode: "" }))).toBe(true);
    expect(canSellOffline(cart({ couponCode: null }))).toBe(true);
  });
});

describe("telling the cashier everything at once", () => {
  it("reports EVERY reason, not the first", () => {
    // A cashier who fixes the tender and is then told about the medicine has
    // been interrupted twice for one decision.
    const refusals = refusalsFor({
      lines: [{ name: "Panadol", offline_ok: false }],
      paymentMethod: "credit",
      orderType: "dine_in",
      redeemPoints: 50,
      couponCode: "EID50",
    });

    expect(refusals).toHaveLength(5);
  });
});

describe("an item with nothing said about it", () => {
  it("is allowed — the projection marks what is BLOCKED, not what is fine", () => {
    // Defaulting to refusal would stop a shop selling the moment a field was
    // added to the catalog and an older till had not learned it yet.
    expect(canSellOffline(cart({ lines: [{ name: "Loose sugar" }] }))).toBe(true);
  });
});

describe("money going back out", () => {
  // Unlike a sale there is no cart to inspect — a refund needs the server
  // whatever is on it. What this checks is that the WORDS do their job.

  it("always refuses, refund and exchange alike", () => {
    expect(Object.keys(MONEY_BACK_OFFLINE)).toEqual(["refund", "exchange"]);
  });

  it("names the shared figures rather than saying 'not allowed'", () => {
    // "Not allowed" sends a cashier looking for a setting to turn on.
    expect(MONEY_BACK_OFFLINE.refund.reason).toMatch(/another till could be changing/);
    expect(MONEY_BACK_OFFLINE.exchange.reason).toMatch(/khata/);
  });

  it("tells them what to DO, which is the part that saves the customer", () => {
    // Taking the details is the thing that turns a refused refund into a
    // refund that happens tomorrow instead of an argument today.
    expect(MONEY_BACK_OFFLINE.refund.fix).toMatch(/take the customer's details/i);
    expect(MONEY_BACK_OFFLINE.exchange.fix).toBeDefined();
  });
});
