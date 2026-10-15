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

  it("may start a return or an exchange — a supervisor's PIN finishes it (B01) — and never a void", () => {
    expect(may).toEqual({ refunds: true, exchanges: true, voids: false, needsApproval: true });
  });
});

describe("a shift supervisor — holds both", () => {
  const may = afterTheSale(holding("sales.manage", "sales.void", "sales.refund", "discounts.override"));

  it("is offered all of it", () => {
    expect(may).toEqual({ refunds: true, exchanges: true, voids: true, needsApproval: false });
  });
});

describe("the two are separate keys", () => {
  it("Refund a sale gives the return and the exchange, and not the void", () => {
    expect(afterTheSale(holding("sales.manage", "sales.refund"))).toEqual({ refunds: true, exchanges: true, voids: false, needsApproval: false });
  });

  it("Void a completed sale gives the cancel; a refund still asks a supervisor's PIN", () => {
    expect(afterTheSale(holding("sales.manage", "sales.void"))).toEqual({ refunds: true, exchanges: true, voids: true, needsApproval: true });
  });

  it("an exchange goes with the refund — it hands goods back", () => {
    expect(afterTheSale(holding("sales.void")).exchanges).toBe(false);
    expect(afterTheSale(holding("sales.refund")).exchanges).toBe(true);
  });
});
