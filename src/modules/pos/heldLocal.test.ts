import { beforeEach, describe, expect, it } from "vitest";

import { claimLocalHeld, holdLocally, isLocalHeld, localHeld, removeLocalHeld } from "./heldLocal";

/**
 * A basket parked on this till when there is no server to park it on.
 *
 * Online a held ticket is shop-wide — parked at lane 1, picked up at lane 3.
 * Offline that is not available, so the offline hold is honestly smaller and
 * says so: local to this device. Pretending otherwise would be worse than not
 * offering it.
 */

const SHOP = "shop-a";
const cart = { items: [] };

beforeEach(() => localStorage.clear());

describe("parking a basket with no server", () => {
  it("hands the ticket back on this till", () => {
    holdLocally({ label: "Ahmed", cart, total_estimate: 990 }, SHOP);

    const rows = localHeld(SHOP);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Ahmed");
    expect(rows[0].local).toBe(true);
  });

  it("marks the id so a caller never asks the server about it", () => {
    // The server has never heard of this ticket. Asking would 404 on a basket
    // sitting in front of the cashier.
    const row = holdLocally({ cart, total_estimate: 100 }, SHOP);
    expect(isLocalHeld(row.id)).toBe(true);
    expect(isLocalHeld("9f1c2b34-0000-0000-0000-000000000000")).toBe(false);
  });

  it("claiming takes it back and removes it in the same step", () => {
    const row = holdLocally({ cart, total_estimate: 100 }, SHOP);

    expect(claimLocalHeld(row.id, SHOP)?.id).toBe(row.id);
    // Gone, so the same basket cannot be rung twice.
    expect(localHeld(SHOP)).toHaveLength(0);
    expect(claimLocalHeld(row.id, SHOP)).toBeNull();
  });

  it("removes one without touching the others", () => {
    const a = holdLocally({ label: "A", cart, total_estimate: 1 }, SHOP);
    holdLocally({ label: "B", cart, total_estimate: 2 }, SHOP);

    removeLocalHeld(a.id, SHOP);
    expect(localHeld(SHOP).map((r) => r.label)).toEqual(["B"]);
  });
});

describe("what it must not do", () => {
  it("never shows one shop's basket to another", () => {
    // One browser can serve two shops. A ticket is a customer's basket, and it
    // belongs to the shop it was rung in.
    holdLocally({ cart, total_estimate: 100 }, "shop-a");

    expect(localHeld("shop-b")).toHaveLength(0);
    expect(localHeld("shop-a")).toHaveLength(1);
  });

  it("forgets yesterday's ticket", () => {
    const day = 24 * 60 * 60 * 1000;
    holdLocally({ cart, total_estimate: 100 }, SHOP, Date.now() - day);

    // Twelve hours is a parked customer; a day is a till nobody cleared.
    expect(localHeld(SHOP)).toHaveLength(0);
  });

  it("survives a corrupt value rather than stopping the till", () => {
    localStorage.setItem("shopos-pos-held", "{not json");

    // A till that will not open is worse in every way than one that opens
    // knowing less.
    expect(localHeld(SHOP)).toEqual([]);
    expect(() => holdLocally({ cart, total_estimate: 100 }, SHOP)).not.toThrow();
  });
});
