import { describe, expect, it } from "vitest";
import { mayWorkTable } from "./ownership";
import type { User } from "../auth/types";

/**
 * The client half of table ownership. The backend is the authority and refuses
 * every write on its own; this decides what a waiter is SHOWN, so a table that
 * is not theirs reads as somebody else's instead of failing when tapped.
 *
 * It must agree with RestaurantTicketController::assertMayWork exactly. A
 * client that is stricter hides work people are allowed to do; a client that is
 * looser walks them into a refusal.
 */
const staff = (id: string, permissions: string[] = []): User =>
  ({ id, role: "staff", permissions } as unknown as User);

describe("mayWorkTable", () => {
  const imran = staff("u-imran");
  const sana = staff("u-sana");

  it("lets a waiter work their own table", () => {
    expect(mayWorkTable(imran, "u-imran")).toBe(true);
  });

  it("keeps a waiter off another waiter's table", () => {
    expect(mayWorkTable(sana, "u-imran")).toBe(false);
  });

  /** A counter takeaway has no waiter, and nobody's table is everybody's. */
  it("treats an unclaimed tab as open to anyone", () => {
    expect(mayWorkTable(sana, null)).toBe(true);
    expect(mayWorkTable(sana, undefined)).toBe(true);
  });

  it("lets the till pick up anyone's table", () => {
    const cashier = staff("u-bilal", ["sales.manage", "tables.serve_any"]);

    expect(mayWorkTable(cashier, "u-imran")).toBe(true);
  });

  /** Mirrors the backend: an owner holds every permission implicitly. */
  it("lets an owner work any table without the permission listed", () => {
    const owner = { id: "u-owner", role: "shop_owner", permissions: [] } as unknown as User;

    expect(mayWorkTable(owner, "u-imran")).toBe(true);
  });

  it("refuses when nobody is signed in", () => {
    expect(mayWorkTable(null, "u-imran")).toBe(false);
  });

  /**
   * The permission is about tables, not about selling. Holding the floor's
   * permission must not quietly imply holding everyone else's tables — that is
   * exactly the state this feature replaced.
   */
  it("does not treat sales.manage as permission to take a table", () => {
    expect(mayWorkTable(staff("u-new", ["sales.manage"]), "u-imran")).toBe(false);
  });
});
