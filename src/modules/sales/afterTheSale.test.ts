import { describe, expect, it } from "vitest";

import { afterTheSale } from "./afterTheSale";

/**
 * A sale's sheet offers only what the server will let this person do.
 *
 * The lines are the server's (`routes/api.php`: cancel → sales.void; returns,
 * returns/worth and exchange → sales.refund). The job presets beside each
 * case are `App\Support\StaffPresets`.
 */

const holding = (...permissions: string[]) => (permission: string) => permissions.includes(permission);

describe("a cashier — rings sales, gives a discount, keeps the customer book", () => {
  const may = afterTheSale(holding("sales.manage", "discounts.apply", "customers.manage", "tables.serve_any"));

  it("is offered none of it: they can ring a sale, not undo one", () => {
    expect(may).toEqual({ refunds: false, exchanges: false, voids: false });
  });
});

describe("a shift supervisor — holds both", () => {
  const may = afterTheSale(holding("sales.manage", "sales.void", "sales.refund", "discounts.override"));

  it("is offered all of it", () => {
    expect(may).toEqual({ refunds: true, exchanges: true, voids: true });
  });
});

describe("the two are separate keys", () => {
  it("Refund a sale gives the return and the exchange, and not the void", () => {
    expect(afterTheSale(holding("sales.manage", "sales.refund"))).toEqual({ refunds: true, exchanges: true, voids: false });
  });

  it("Void a completed sale gives the cancel, and not a refund", () => {
    expect(afterTheSale(holding("sales.manage", "sales.void"))).toEqual({ refunds: false, exchanges: false, voids: true });
  });

  it("an exchange goes with the refund — it hands goods back", () => {
    expect(afterTheSale(holding("sales.void")).exchanges).toBe(false);
    expect(afterTheSale(holding("sales.refund")).exchanges).toBe(true);
  });
});
