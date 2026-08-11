import { describe, expect, it } from "vitest";

import { adminNav, type NavItem } from "./AppSidebar";

/**
 * What each kind of platform staffer is offered on the admin rail.
 *
 * The shop rail has been filtered by permission since the day a waiter was
 * found looking at the takings. The ADMIN rail never was — it was a flat list,
 * so a person hired to schedule banner ads was offered Tenants, Plans, Billing,
 * Platform Staff and the Audit Log, and learned which were real by clicking
 * them and reading a 403. Same defect, other console.
 *
 * These assert on the LIST rather than a count: a count tells you something
 * changed, and what changed is the entire question.
 */

const MAIN: NavItem[] = [
  { name: "Dashboard", path: "/admin", icon: null },
  { name: "Tenants", path: "/admin/tenants", icon: null },
  { name: "Plans", path: "/admin/plans", icon: null },
  { name: "Billing & Payments", path: "/admin/payments", icon: null },
];

const PLATFORM: NavItem[] = [
  { name: "Configuration", path: "/admin/config", icon: null },
  { name: "Banners / Ads", path: "/admin/banners", icon: null },
  { name: "Announcements", path: "/admin/announcements", icon: null },
  { name: "Platform Staff", path: "/admin/staff", icon: null },
  { name: "Audit Log", path: "/admin/audit-logs", icon: null },
];

/** Mirrors App\Support\Permissions::platform(). */
const ALL_PLATFORM_PERMISSIONS = [
  "tenants.view",
  "tenants.create",
  "tenants.update",
  "tenants.delete",
  "tenants.suspend",
  "tenants.assign_plan",
  "tenants.reset_password",
  "billing.view",
  "platform_staff.manage",
  "banners.manage",
  "announcements.manage",
];

function pathsFor(permissions: string[], isSuperAdmin = false): string[] {
  return [
    ...adminNav(MAIN, isSuperAdmin, permissions),
    ...adminNav(PLATFORM, isSuperAdmin, permissions),
  ].map((i) => i.path!);
}

describe("the admin rail", () => {
  it("offers a super admin everything", () => {
    // By ROLE, not by list — the server says the same in User::hasPermission,
    // and a rail stricter than the API it fronts hides working screens.
    expect(pathsFor([], true)).toEqual([
      "/admin",
      "/admin/tenants",
      "/admin/plans",
      "/admin/payments",
      "/admin/config",
      "/admin/banners",
      "/admin/announcements",
      "/admin/staff",
      "/admin/audit-logs",
    ]);
  });

  it("offers a banner scheduler the dashboard and their own screen", () => {
    // The case that motivated this. Before the filter, this person was offered
    // every tenant on the platform and the revenue ledger.
    expect(pathsFor(["banners.manage"])).toEqual(["/admin", "/admin/banners"]);
  });

  it("keeps the revenue ledger away from staff without billing.view", () => {
    const support = pathsFor(["tenants.view", "tenants.update", "tenants.suspend"]);

    expect(support).toContain("/admin/tenants");
    expect(support).not.toContain("/admin/payments");
  });

  it("offers billing to a finance staffer and nothing else", () => {
    expect(pathsFor(["billing.view"])).toEqual(["/admin", "/admin/payments"]);
  });

  it("never offers the audit log to platform staff", () => {
    // The server gates it on role:super_admin, and no permission grants it —
    // so no permission list may put it on the rail either.
    expect(pathsFor(ALL_PLATFORM_PERMISSIONS)).not.toContain("/admin/audit-logs");
  });

  it("always offers the dashboard, because /admin lands there", () => {
    // A home page that 403s is not a permission model, it is a locked door.
    // Its CONTENTS are filtered instead — the revenue figures are withheld
    // server-side from staff without billing.view.
    expect(pathsFor([])).toEqual(["/admin"]);
  });

  it("hides everything a staffer with no permissions cannot reach", () => {
    expect(pathsFor([])).not.toContain("/admin/tenants");
    expect(pathsFor([])).not.toContain("/admin/staff");
    expect(pathsFor([])).not.toContain("/admin/config");
  });

  it("does not treat an undefined permission list as full access", () => {
    // A staff record that arrives before /me has filled in permissions must
    // fail closed. Failing open here is a rail that flashes every screen on
    // first paint.
    expect(pathsFor(undefined as unknown as string[])).toEqual(["/admin"]);
  });
});
