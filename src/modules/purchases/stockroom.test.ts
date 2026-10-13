import { describe, expect, it } from "vitest";

import { canVisit } from "../../common/routing/screenPermissions";
import { purchaseRights } from "./stockroom";

/**
 * The buyer and the stock keeper, at the two screens about deliveries.
 *
 * The server lets a stock keeper read an order and receive against it; the
 * menu offers them the screen; the screen said "No access". Each right below
 * is the server's own line (`routes/api.php`, under `feature:purchasing`).
 */

const holding = (...permissions: string[]) => (permission: string) => permissions.includes(permission);

describe("a stock keeper — Products and Inventory, and not a buyer", () => {
  const rights = purchaseRights(holding("products.manage", "inventory.manage"));

  it("sees the orders and can receive against them — it is the job", () => {
    expect(rights.seesOrders, "the stock keeper is walled out of the orders they are there to receive").toBe(true);
    expect(rights.receives).toBe(true);
  });

  it("cannot raise, place or cancel one — that is buying", () => {
    expect(rights.raises).toBe(false);
  });

  it("can see who a delivery came from, and cannot edit the book or pay anybody", () => {
    expect(rights.seesSuppliers).toBe(true);
    expect(rights.editsSuppliers).toBe(false);
    expect(rights.paysSuppliers).toBe(false);
  });
});

describe("a buyer — Suppliers and Purchase orders", () => {
  const rights = purchaseRights(holding("suppliers.manage", "purchases.manage"));

  it("does all of it", () => {
    expect(rights).toEqual({ seesOrders: true, receives: true, raises: true, seesSuppliers: true, editsSuppliers: true, paysSuppliers: true });
  });
});

describe("somebody who keeps the supplier book and buys nothing", () => {
  const rights = purchaseRights(holding("suppliers.manage"));

  it("edits the book, and is not offered a Pay button the server would refuse", () => {
    expect(rights.seesSuppliers).toBe(true);
    expect(rights.editsSuppliers).toBe(true);
    expect(rights.paysSuppliers, "Pay is offered to somebody the server refuses").toBe(false);
    expect(rights.seesOrders).toBe(false);
  });
});

describe("a cashier", () => {
  const rights = purchaseRights(holding("sales.manage", "discounts.apply", "customers.manage"));

  it("has no part in any of it", () => {
    expect(Object.values(rights).some(Boolean)).toBe(false);
  });
});

describe("the screens open for exactly whom the menu offers them to", () => {
  // The menu and the address bar ask `canVisit`. A screen that then says
  // "No access" to somebody `canVisit` let in is the fault this file is for.
  const people: Record<string, string[]> = {
    "a stock keeper": ["products.manage", "inventory.manage"],
    "a buyer": ["purchases.manage"],
    "the keeper of the supplier book": ["suppliers.manage"],
    "a cashier": ["sales.manage"],
    "an accountant": ["expenses.manage", "reports.view"],
  };

  it.each(Object.entries(people))("%s — Purchase orders", (_who, permissions) => {
    const can = holding(...permissions);
    expect(purchaseRights(can).seesOrders).toBe(canVisit("/tenant/purchases", can));
  });

  it.each(Object.entries(people))("%s — Suppliers", (_who, permissions) => {
    const can = holding(...permissions);
    expect(purchaseRights(can).seesSuppliers).toBe(canVisit("/tenant/suppliers", can));
  });
});
