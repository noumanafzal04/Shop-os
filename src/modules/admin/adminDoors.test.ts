import { describe, expect, it } from "vitest";

import { canVisitAdmin } from "../../common/routing/adminScreenPermissions";

/**
 * THE ADMIN SIDE'S OWN GAPS, and the rule that keeps closing behind them.
 *
 * ── What the audit found ────────────────────────────────────────────────
 *
 * `scripts/dead-endpoints.py` reported two admin routes with no caller
 * anywhere: `commission-charges/{id}/waive` and `commission-invoices/{id}/void`
 * — both written, both tested, both reachable by nothing. The only thing the
 * commission screen could do to an invoice was mark it PAID, so a shop
 * disputing a charge could be collected from or ignored and nothing else.
 *
 * That is the shape this codebase keeps producing: capability built, one link
 * missing, nothing fails.
 *
 * ── And the one this session created ────────────────────────────────────
 *
 * A shop that adds a rider mints their id and the profile is `approved`, so
 * they arrived in the admin's Approved queue beside people staff had actually
 * vetted — no CNIC, no documents, and until the id is claimed, no name. That
 * list is the platform's record of who it has checked, and it quietly stopped
 * being one.
 *
 * ── Why the permission map is what this file asserts ────────────────────
 *
 * Because a path ABSENT from it is open to anyone, and both new doors are
 * super-admin on the server. A screen the rail offers and the API answers 403
 * to is the failure that map was written to end, and it fails silently in the
 * direction nobody tests: the screen looks fine until somebody without the
 * role opens it.
 */
describe("the doors the admin side just grew", () => {
  const STAFF = ["tenants.view", "riders.manage", "commission.manage", "banners.manage"];

  it("does not offer customer creation to staff the server would refuse", () => {
    expect(canVisitAdmin("/admin/customers", false, STAFF)).toBe(false);
    expect(canVisitAdmin("/admin/customers", true, undefined)).toBe(true);
  });

  /**
   * The detector, checked against a known-open path. Without this the
   * assertion above would pass on a `canVisitAdmin` that refuses everything.
   */
  it("still opens the screens that are genuinely permission-gated", () => {
    expect(canVisitAdmin("/admin/riders", false, STAFF)).toBe(true);
    expect(canVisitAdmin("/admin/commission", false, STAFF)).toBe(true);
    expect(canVisitAdmin("/admin/payments", false, STAFF)).toBe(false);
  });

  /**
   * A path nobody put in the map is open to every platform role. That is
   * deliberate and correct for `/admin`, and a trap for anything else — so a
   * new screen landing without an entry should be noticed here rather than by
   * somebody reading a 403.
   */
  it("leaves exactly one admin path ungated, and it is the dashboard", () => {
    const ungated = [
      "/admin",
      "/admin/tenants",
      "/admin/riders",
      "/admin/customers",
      "/admin/commission",
      "/admin/audit-logs",
      "/admin/staff",
      "/admin/payments",
    ].filter((p) => canVisitAdmin(p, false, []));

    expect(ungated).toEqual(["/admin"]);
  });
});
