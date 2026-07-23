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
  "sales.manage": { label: "Sales & invoices" },
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
