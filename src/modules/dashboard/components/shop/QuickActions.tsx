import { Link } from "react-router";

import type { Capabilities } from "./capabilities";

/**
 * Every action is a route this tenant actually has — see App.tsx's feature
 * gates — AND one this person may open. A quick action that bounces you back
 * to the page you launched it from is the worst kind of button.
 */
export function QuickActions({ caps }: { caps: Capabilities }) {
  const actions: Array<{ label: string; to: string }> = [];

  if (caps.pos) actions.push({ label: "Open POS", to: "/tenant/pos" });
  if (caps.dineIn) actions.push({ label: "Dine-in floor", to: "/tenant/dine-in" });
  if (caps.canSell) actions.push({ label: "New sale", to: "/tenant/sales/new" });
  if (caps.catalog) {
    actions.push({ label: caps.products ? "Add product" : "Add service", to: "/tenant/products/new" });
  }
  if (caps.tracksStock) actions.push({ label: "Stock in", to: "/tenant/purchases" });
  if (caps.keepsBooks) actions.push({ label: "Record expense", to: "/tenant/expenses" });
  if (caps.keepsBooks) actions.push({ label: "Cashbook", to: "/tenant/cashbook" });
  if (caps.marketplace) actions.push({ label: "Online orders", to: "/tenant/orders" });
  actions.push({ label: "Reports", to: "/tenant/reports" });

  const allowed = actions.filter((action) => caps.visit(action.to));

  if (allowed.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {allowed.map((action) => (
        <Link
          key={action.to}
          to={action.to}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 shadow-theme-xs transition-colors hover:border-brand-500 hover:text-brand-600 dark:border-gray-700 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-brand-500 dark:hover:text-brand-400"
        >
          {action.label}
        </Link>
      ))}
    </div>
  );
}
