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
/** How a tile's icon is coloured. Whole class names — Tailwind ships what it can read. */
const TILE_TONE = {
  brand: "bg-brand-50 text-brand-600 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:ring-brand-500/25",
  success: "bg-success-50 text-success-600 ring-success-100 dark:bg-success-500/15 dark:text-success-400 dark:ring-success-500/25",
  warning: "bg-warning-50 text-warning-600 ring-warning-100 dark:bg-warning-500/15 dark:text-warning-400 dark:ring-warning-500/25",
  purple: "bg-theme-purple-500/10 text-theme-purple-500 ring-theme-purple-500/20",
  orange: "bg-orange-50 text-orange-600 ring-orange-100 dark:bg-orange-500/15 dark:text-orange-400 dark:ring-orange-500/25",
  blue: "bg-blue-light-50 text-blue-light-600 ring-blue-light-100 dark:bg-blue-light-500/15 dark:text-blue-light-400 dark:ring-blue-light-500/25",
} as const;

interface Action {
  label: string;
  /** What pressing it gets you, in four words. */
  hint: string;
  to: string;
  icon: ReactNode;
  tone: keyof typeof TILE_TONE;
  /** Lower is offered sooner. The first four are the row under the hero. */
  rank: number;
}

/** How many go in the row at the top of the page. */
const TOP = 4;

/**
 * The things a shop does first, as buttons.
 *
 * They were nine small pills at the very BOTTOM of the dashboard, after the
 * charts, the tables and the timeline — so "Open POS", the reason most people
 * open the page, was a scroll and a search away.
 *
 *   `show="top"`   the four this shop reaches for most, as tiles, directly
 *                  under the hero.
 *   `show="rest"`  everything else, as the small row it always was, at the
 *                  foot of the page.
 *   (neither)      all of them — which is what the reachability guard renders,
 *                  so no offer can hide from it behind a prop.
 */
export function QuickActions({ caps, show = "all" }: { caps: Capabilities; show?: "all" | "top" | "rest" }) {
  const actions: Action[] = [];

  if (caps.pos) actions.push({ label: "Open POS", hint: "Ring a sale at the till", to: "/tenant/pos", icon: <DollarLineIcon className="size-5" />, tone: "brand", rank: 1 });
  if (caps.dineIn) actions.push({ label: "Dine-in floor", hint: "Tables and running tabs", to: "/tenant/dine-in", icon: <TableIcon className="size-5" />, tone: "orange", rank: 2 });
  // `pos`, not `canSell`: an online shop can sell, but not by hand — the form
  // posts to a route only the till module opens, and it said so at Complete.
  if (caps.pos) actions.push({ label: "New sale", hint: "An invoice, written by hand", to: "/tenant/sales/new", icon: <TaskIcon className="size-5" />, tone: "blue", rank: 5 });
  if (caps.catalog) {
    actions.push({
      label: caps.products ? "Add product" : "Add service",
      hint: caps.products ? "Put something on the shelf" : "Something new to offer",
      to: "/tenant/products/new",
      icon: <BoxIconLine className="size-5" />,
      tone: "purple",
      rank: 7,
    });
  }
  // "Stock in" means RAISE A PURCHASE ORDER, so it follows the purchasing
  // module and not `tracksStock`. A shop that counts its shelves but buys from
  // the market keeps its stock figures and has no supplier book — offering it
  // this button sent it to /tenant/purchases, which its own route guard then
  // refused. Adjusting stock by hand lives on the catalog, and is still there.
  if (caps.buysFromSuppliers) actions.push({ label: "Stock in", hint: "Raise a purchase order", to: "/tenant/purchases", icon: <BoxIconLine className="size-5" />, tone: "success", rank: 8 });
  if (caps.keepsBooks) actions.push({ label: "Record expense", hint: "Money going out", to: "/tenant/expenses", icon: <FileIcon className="size-5" />, tone: "warning", rank: 4 });
  if (caps.keepsBooks) actions.push({ label: "Cashbook", hint: "In and out, day by day", to: "/tenant/cashbook", icon: <ListIcon className="size-5" />, tone: "success", rank: 9 });
  if (caps.marketplace) actions.push({ label: "Online orders", hint: "Waiting to be packed", to: "/tenant/orders", icon: <PlugInIcon className="size-5" />, tone: "purple", rank: 3 });
  actions.push({ label: "Reports", hint: "The whole picture", to: "/tenant/reports", icon: <PieChartIcon className="size-5" />, tone: "blue", rank: 6 });

  const allowed = actions.filter((action) => caps.visit(action.to)).sort((a, b) => a.rank - b.rank);
  const top = allowed.slice(0, TOP);
  const rest = allowed.slice(TOP);

  const tiles = show === "rest" ? [] : top;
  const pills = show === "top" ? [] : rest;

  if (tiles.length === 0 && pills.length === 0) return null;

  return (
    <>
      {tiles.length > 0 && (
        <nav aria-label="Quick actions" className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {tiles.map((action) => (
            <Link
              key={action.to}
              to={action.to}
              className="group flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-theme-md sm:p-4 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-500/50"
            >
              <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ${TILE_TONE[action.tone]}`}>
                {action.icon}
              </span>
              <span className="min-w-0">
                {/* Wraps on a phone rather than cutting: "Record expe…" is a
                    button nobody can read the name of. */}
                <span className="block text-theme-sm font-semibold leading-tight text-gray-900 sm:truncate dark:text-white/90">{action.label}</span>
                <span className="hidden truncate text-theme-xs text-gray-500 sm:block dark:text-gray-400">{action.hint}</span>
              </span>
              <span aria-hidden className="ml-auto hidden text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500 sm:block dark:text-gray-600">→</span>
            </Link>
          ))}
        </nav>
      )}

      {pills.length > 0 && (
        // Carded rather than loose buttons: the page ends on a panel like every
        // other band above it, instead of trailing off into floating chrome.
        <SectionCard title={show === "all" ? "Quick actions" : "More shortcuts"} icon={<BoltIcon className="size-5" />}>
          <div className="flex flex-wrap gap-3">
            {pills.map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className="group flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 shadow-theme-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 hover:shadow-theme-md dark:border-gray-700 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400"
              >
                <span className="text-gray-500 transition-colors group-hover:text-brand-500 dark:text-gray-400 [&_svg]:size-4">
                  {action.icon}
                </span>
                {action.label}
              </Link>
            ))}
          </div>
        </SectionCard>
      )}
    </>
  );
}
