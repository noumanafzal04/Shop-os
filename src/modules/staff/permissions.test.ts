import { describe, expect, it } from "vitest";

import { PERMISSION_LABELS, hintFor, labelFor } from "./permissions";

/**
 * Every permission the server can hand out has a label written for a human.
 *
 * `labelFor` falls back to a humanized slug, which is why this went unnoticed:
 * two permissions added on the backend rendered as "Tenants Reset Password" and
 * "Billing View" on the screen where an admin decides who gets them. Nothing
 * looked broken. The most dangerous checkbox on the platform — the one that
 * lets its holder sign in as any business — was offered with no explanation at
 * all, and a permission screen where the boxes are not explained is a permission
 * screen where the wrong box gets ticked.
 *
 * The lists below mirror App\Support\Permissions::platform() and ::tenant().
 * Adding a key there and not here is caught by PresetCanDoItsJobTest on the
 * backend; adding it to both and forgetting the label is caught right here.
 */

const PLATFORM = [
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

const TENANT = [
  "staff.manage",
  "products.manage",
  "inventory.manage",
  "suppliers.manage",
  "purchases.manage",
  "sales.manage",
  "kitchen.manage",
  "discounts.apply",
  "discounts.override",
  "sales.void",
  "sales.refund",
  "tables.serve_any",
  "customers.manage",
  "coupons.manage",
  "expenses.manage",
  "reports.view",
  "reservations.manage",
  "orders.manage",
  "settings.manage",
];

/**
 * The ones whose consequence is not obvious from four words. A hint on every
 * row is noise, and noise on a permission screen is how the wrong box gets
 * ticked — but these five each let somebody do something they would not guess
 * from the label.
 */
const MUST_EXPLAIN = [
  "tenants.reset_password",
  "billing.view",
  "sales.void",
  "sales.refund",
  "tables.serve_any",
];

describe("permission labels", () => {
  it.each([...PLATFORM, ...TENANT])("%s reads as something a person wrote", (key) => {
    expect(PERMISSION_LABELS[key], `${key} has no label — it will render as a slug`).toBeDefined();
  });

  it.each(MUST_EXPLAIN)("%s explains what it actually allows", (key) => {
    expect(hintFor(key), `${key} is consequential and has no hint`).toBeTruthy();
  });

  it("warns that resetting a password means signing in as that business", () => {
    // Not just "a hint exists" — the specific thing an admin must understand
    // before ticking it.
    expect(hintFor("tenants.reset_password")).toMatch(/sign in as that business/i);
  });

  it("still renders an unknown key rather than blanking the row", () => {
    // The fallback stays: a backend permission added tomorrow must not leave an
    // unlabelled checkbox on the screen.
    expect(labelFor("something.new")).toBe("Something New");
  });

  it("does not label a permission the server never issues", () => {
    const known = new Set([...PLATFORM, ...TENANT]);
    const stale = Object.keys(PERMISSION_LABELS).filter((k) => !known.has(k));

    // A label for a permission that no longer exists is a checkbox that can
    // never be granted, or worse, one that used to mean something else.
    expect(stale).toEqual([]);
  });
});
