import type { ReactNode } from "react";
import { Link } from "react-router";

import {
  BoltIcon,
  BoxIconLine,
  DollarLineIcon,
  FileIcon,
  ListIcon,
  PieChartIcon,
  PlugInIcon,
  TableIcon,
  TaskIcon,
} from "../../../../icons";
import type { Capabilities } from "./capabilities";
import { SectionCard } from "./SectionCard";

/**
 * Every action is a route this tenant actually has — see App.tsx's feature
 * gates — AND one this person may open. A quick action that bounces you back
 * to the page you launched it from is the worst kind of button.
 */
export function QuickActions({ caps }: { caps: Capabilities }) {
  const actions: Array<{ label: string; to: string; icon: ReactNode }> = [];

  if (caps.pos) actions.push({ label: "Open POS", to: "/tenant/pos", icon: <DollarLineIcon className="size-4" /> });
  if (caps.dineIn) actions.push({ label: "Dine-in floor", to: "/tenant/dine-in", icon: <TableIcon className="size-4" /> });
  if (caps.canSell) actions.push({ label: "New sale", to: "/tenant/sales/new", icon: <TaskIcon className="size-4" /> });
  if (caps.catalog) {
    actions.push({
      label: caps.products ? "Add product" : "Add service",
      to: "/tenant/products/new",
      icon: <BoxIconLine className="size-4" />,
    });
  }
  // "Stock in" means RAISE A PURCHASE ORDER, so it follows the purchasing
  // module and not `tracksStock`. A shop that counts its shelves but buys from
  // the market keeps its stock figures and has no supplier book — offering it
  // this button sent it to /tenant/purchases, which its own route guard then
  // refused. Adjusting stock by hand lives on the catalog, and is still there.
  if (caps.buysFromSuppliers) actions.push({ label: "Stock in", to: "/tenant/purchases", icon: <BoxIconLine className="size-4" /> });
  if (caps.keepsBooks) actions.push({ label: "Record expense", to: "/tenant/expenses", icon: <FileIcon className="size-4" /> });
  if (caps.keepsBooks) actions.push({ label: "Cashbook", to: "/tenant/cashbook", icon: <ListIcon className="size-4" /> });
  if (caps.marketplace) actions.push({ label: "Online orders", to: "/tenant/orders", icon: <PlugInIcon className="size-4" /> });
  actions.push({ label: "Reports", to: "/tenant/reports", icon: <PieChartIcon className="size-4" /> });

  const allowed = actions.filter((action) => caps.visit(action.to));

  if (allowed.length === 0) return null;

  return (
    // Carded rather than loose buttons: the page ends on a panel like every
    // other band above it, instead of trailing off into floating chrome.
    <SectionCard title="Quick actions" icon={<BoltIcon className="size-5" />}>
      <div className="flex flex-wrap gap-3">
        {allowed.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="group flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 shadow-theme-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 hover:shadow-theme-md dark:border-gray-700 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400"
          >
            <span className="text-gray-500 transition-colors group-hover:text-brand-500 dark:text-gray-400">
              {action.icon}
            </span>
            {action.label}
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}
