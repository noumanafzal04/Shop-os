/**
 * Friendly labels + grouping for permission keys (mirrors the backend
 * App\Support\Permissions registry). Unknown keys fall back to a humanized
 * form so a newly-added backend permission still renders sensibly.
 */
export const PERMISSION_LABELS: Record<string, { label: string; hint?: string }> = {
  // Platform scope
  "tenants.view": { label: "View tenants" },
  "tenants.create": { label: "Create tenants" },
  "tenants.update": { label: "Edit tenants" },
  "tenants.delete": { label: "Delete tenants" },
  "tenants.suspend": { label: "Suspend / activate tenants" },
  "tenants.assign_plan": { label: "Assign plans & record payments" },
  "platform_staff.manage": { label: "Manage platform staff" },
  // Tenant scope
  "staff.manage": { label: "Manage staff" },
  "products.manage": { label: "Products & categories" },
  "inventory.manage": { label: "Inventory adjustments" },
  "suppliers.manage": { label: "Suppliers" },
  "purchases.manage": { label: "Purchase orders & payables" },
  "sales.manage": { label: "Sales & invoices" },
  "discounts.apply": { label: "Give a discount", hint: "Up to the ceiling set in Shop settings." },
  "discounts.override": { label: "Discount past the ceiling", hint: "Exceed the shop's discount limit." },
  "sales.void": { label: "Void a completed sale", hint: "Restores stock and reverses the money." },
  "sales.refund": { label: "Refund a sale", hint: "Hand money back." },
  "tables.serve_any": {
    label: "Serve any table",
    hint: "Work and settle other waiters' tabs. Without it, their own tables only.",
  },
  "customers.manage": { label: "Customers" },
  "coupons.manage": { label: "Coupons & promotions" },
  "expenses.manage": { label: "Expenses" },
  "reports.view": { label: "View reports" },
  "reservations.manage": { label: "Reservations" },
  "orders.manage": { label: "Online orders" },
  "settings.manage": { label: "Shop settings" },
};

export function labelFor(key: string): string {
  return (
    PERMISSION_LABELS[key]?.label ??
    key.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * The one-line explanation, where a label alone would leave an owner guessing.
 * Most keys need none — a hint on every row is noise, and noise on a permission
 * screen is how the wrong box gets ticked.
 */
export function hintFor(key: string): string | undefined {
  return PERMISSION_LABELS[key]?.hint;
}
