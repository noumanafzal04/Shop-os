import { describe, expect, it } from "vitest";

import { routeFeatures, routeIsOpen } from "./routeFeatures";
import { EVERY_MODULE, TRADE_FEATURES, settleFeatures } from "./tradeFeatures";

/**
 * A DOOR THE SERVER KEEPS SHUT IS SHUT ON THIS SIDE TOO.
 *
 * `offeredIsReachable` holds one direction: whatever a surface OFFERS, the
 * route behind it must let the shop in. This holds the other, for the one
 * route where the two sides had parted:
 *
 *   The server gave the sale HISTORY a module gate (`feature:pos,marketplace,
 *   products,services`) so that a books-only business would not be handed a
 *   Sales screen answering "you have no sales". The panel's route was left
 *   with no gate at all. The menu never offered it — so no test that walks
 *   the menu could see it — and a books-only owner who typed the address, or
 *   followed an old bookmark, got the whole screen drawn around two refused
 *   requests.
 *
 * The server's list is restated here because a test in this repo cannot read
 * the other repo's routes. It is one line, and the test below fails if the
 * route asks for anything else.
 */
const SERVER_ASKS = ["pos", "marketplace", "products", "services"];

const GATES = routeFeatures();

describe("the sale history is behind the gate the server put on it", () => {
  it("asks for exactly what the server asks for", () => {
    const needs = GATES.get("/tenant/sales");

    expect(needs, "/tenant/sales has no module gate at all").toBeDefined();
    expect([...needs![0].anyOf].sort()).toEqual([...SERVER_ASKS].sort());
  });

  it("is shut to a business that only keeps books", () => {
    expect(routeIsOpen(settleFeatures({ ...TRADE_FEATURES.finance }), "/tenant/sales", GATES)).toBe(false);
    expect(routeIsOpen(settleFeatures({ ...TRADE_FEATURES.finance }), "/tenant/sales/new", GATES)).toBe(false);
  });

  it("is open to every trade that sells, and to a shop given everything", () => {
    for (const [trade, features] of Object.entries(TRADE_FEATURES)) {
      if (trade === "finance") continue;

      expect(routeIsOpen(settleFeatures({ ...features }), "/tenant/sales", GATES), trade).toBe(true);
    }
    expect(routeIsOpen(settleFeatures({ ...EVERY_MODULE }), "/tenant/sales", GATES)).toBe(true);
  });

  it("any ONE of the four is enough, as it is on the server", () => {
    for (const key of SERVER_ASKS) {
      expect(routeIsOpen({ [key]: true }, "/tenant/sales", GATES), key).toBe(true);
    }
  });

  it("writing a sale by hand still needs the till inside it", () => {
    // An online shop has its history and no form to ring one up on.
    const online = { products: true, marketplace: true };

    expect(routeIsOpen(online, "/tenant/sales", GATES)).toBe(true);
    expect(routeIsOpen(online, "/tenant/sales/new", GATES)).toBe(false);
    expect(routeIsOpen({ ...online, pos: true }, "/tenant/sales/new", GATES)).toBe(true);
  });
});
