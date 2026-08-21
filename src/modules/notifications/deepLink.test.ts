import { describe, expect, it } from "vitest";

import { screenForLink } from "./deepLink";

/**
 * Does pressing a notification take you where it was talking about?
 *
 * The backend has always shipped a `data.link` and the panel dropped it, so
 * "Expired stock — Augmentin, batch A31" was a sentence with no door. These
 * cases are drawn from the links the backend actually emits (see
 * `App\Support\DeepLinks` and the test beside it that now enumerates every
 * type), because a resolver tested against invented inputs proves nothing about
 * the ones it will really be handed.
 */

const owner = () => true;
const cashier = (permission: string) => permission === "sales.manage";

describe("a notification's link resolves to a screen", () => {
  it("sends an order notification to the orders screen", () => {
    expect(screenForLink("orders/8f2ac1", owner)).toBe("/tenant/orders");
  });

  it("sends both expiry stages to Disposals", () => {
    // The alert that raises these says in its own docblock that it "Links to
    // Disposals". The backend half of that promise was missing for as long as
    // the alerts existed; this is the other half.
    expect(screenForLink("disposals", owner)).toBe("/tenant/disposals");
  });

  it("sends low stock to Inventory, which is a different decision", () => {
    expect(screenForLink("inventory", owner)).toBe("/tenant/inventory");
  });

  it("handles a bare resource and a resource with an id the same way", () => {
    expect(screenForLink("reservations", owner)).toBe("/tenant/reservations");
    expect(screenForLink("reservations/r99", owner)).toBe("/tenant/reservations");
  });
});

describe("and refuses to send anyone nowhere", () => {
  it("offers no destination for an announcement, which has no tenant screen", () => {
    // A real backend link with no shop-side screen behind it. Following it
    // would land a shopkeeper on a not-found, which is worse than a
    // notification that simply is not a link.
    expect(screenForLink("announcements/a1", owner)).toBeNull();
  });

  it("offers no destination a person may not open", () => {
    // Low stock points at /tenant/inventory, which is behind inventory.manage.
    // Sending a cashier there means telling them to go somewhere and then
    // having a guard turn them away.
    expect(screenForLink("inventory", cashier)).toBeNull();
    // And the same person still gets the links their job covers.
    expect(screenForLink("orders/1", cashier)).toBeNull();
  });

  it("ignores a link it does not recognise, and a missing one", () => {
    expect(screenForLink("something/we/never/emit", owner)).toBeNull();
    expect(screenForLink(null, owner)).toBeNull();
    expect(screenForLink(undefined, owner)).toBeNull();
    expect(screenForLink("", owner)).toBeNull();
    // Not a string at all — `data` is Record<string, unknown> on the wire.
    expect(screenForLink(42, owner)).toBeNull();
  });
});
