import type { ReactNode } from "react";

import {
  BoxIconLine,
  CalenderIcon,
  DollarLineIcon,
  FileIcon,
  GroupIcon,
  ListIcon,
  PieChartIcon,
  PlugInIcon,
  TaskIcon,
} from "../../../../icons";
import type { TenantDashboard } from "../../types";
import type { Capabilities } from "./capabilities";
import { MetricTile, MetricTileSkeleton } from "../MetricTile";
import { type Tone } from "./tone";
import { tradeProfile, type FocusKey } from "./trade";

interface TileProps {
  label: string;
  value: string;
  icon: ReactNode;
  tone: Tone;
  /** Signed % against yesterday. Null hides the pill — never prints "0%". */
  delta?: number | null;
  /** Spending up is bad news, so its pill colour flips while the arrow doesn't. */
  invertDelta?: boolean;
  emphasis?: boolean;
  caption?: string;
  /** Last 7 days of this same figure, straight from `sales_series`. */
  spark?: number[];
}

type TileSpec = TileProps & { key: string };

/**
 * The shop's number tile is `MetricTile`, which the platform console renders
 * too. It used to be a second copy of that design living here, and the copies
 * had drifted — different value sizes, and different percentage formatting.
 */
function KpiTile(props: TileProps) {
  return <MetricTile {...props} deltaTitle="Compared with yesterday" />;
}

/** Column counts per tile count, so a 4-tile books dashboard never leaves gaps. */
const COLS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3",
  6: "sm:grid-cols-2 lg:grid-cols-3",
};

interface Props {
  data: TenantDashboard;
  caps: Capabilities;
  money: (n: string | number) => string;
  /** Basic mode shows the three figures a shopkeeper checks, nothing else. */
  compact?: boolean;
}

/**
 * The top KPI strip. Which tiles exist is decided by the tenant's modules: a
 * books-only shop gets a spending strip (its sales figures would all be zero
 * by construction), a shop that sells gets sales/profit/orders.
 */
export function KpiRow({ data, caps, money, compact }: Props) {
  const today = data.today;
  const trade = tradeProfile(caps.businessType);
  const series = data.sales_series;
  const tiles: TileSpec[] = [];

  // A shop on its first day has one point and no direction to draw; the tile
  // then keeps its plain shape rather than reserving room for nothing.
  const spark = (pick: (day: (typeof series)[number]) => number) =>
    series.length > 1 ? series.map(pick) : undefined;

  if (caps.sells) {
    tiles.push({
      key: "revenue",
      label: "Today's Sales",
      value: money(today.revenue),
      delta: today.deltas.revenue,
      icon: <DollarLineIcon className="size-5" />,
      tone: "success",
      spark: spark((d) => d.revenue),
    });

    // Only when the shop actually handed something back. Today's Sales is
    // GROSS — a refund is dated by the day it went out, so netting it into the
    // sales tile would rewrite a day that may already be closed and banked —
    // and without this tile the profit below looks like it was struck from the
    // wrong arithmetic.
    if (today.refunds > 0) {
      tiles.push({
        key: "refunds",
        label: "Refunded Today",
        value: money(today.refunds),
        icon: <DollarLineIcon className="size-5" />,
        tone: "warning",
        spark: spark((d) => d.refunds),
      });
    }
  }

  if (caps.keepsBooks) {
    tiles.push({
      key: "expenses",
      label: "Today's Expenses",
      value: money(today.expenses),
      delta: today.deltas.expenses,
      invertDelta: true,
      icon: <FileIcon className="size-5" />,
      tone: "warning",
      spark: spark((d) => d.expenses),
    });
  }

  if (caps.sells) {
    tiles.push({
      key: "profit",
      label: "Today's Profit",
      value: money(today.profit),
      delta: today.deltas.profit,
      icon: <PieChartIcon className="size-5" />,
      tone: "brand",
      emphasis: true,
      caption: today.refunds > 0
        ? "Sales − refunds − cost of goods − expenses"
        : "Sales − cost of goods − expenses",
      spark: spark((d) => d.profit),
    });

    if (!compact) {
      tiles.push({
        key: "orders",
        label: trade.orders,
        value: today.sales_count.toLocaleString(),
        icon: <TaskIcon className="size-5" />,
        tone: "brand",
      });
      tiles.push({
        key: "customers",
        label: trade.customers,
        value: today.customers_count.toLocaleString(),
        icon: <GroupIcon className="size-5" />,
        tone: "brand",
      });

      // Sixth tile: the figure THIS trade opens the app to check. What the shop
      // is capable of carrying is a module question; which of those figures
      // comes first is a trade one, and only the trade profile knows it.
      const focusTile: Record<FocusKey, TileSpec | null> = {
        expiring: caps.tracksStock
          ? {
              key: "expiring",
              label: "Expiring Within 30 Days",
              value: data.expiring_soon_count.toLocaleString(),
              icon: <CalenderIcon className="size-5" />,
              tone: data.expiring_soon_count > 0 ? "error" : "success",
              caption: data.expiring_soon_count > 0 ? "Move it or lose it" : "Nothing dated soon",
            }
          : null,
        lowStock: caps.tracksStock
          ? {
              key: "low_stock",
              label: "Low Stock Items",
              value: data.low_stock_count.toLocaleString(),
              icon: <BoxIconLine className="size-5" />,
              tone: data.low_stock_count > 0 ? "error" : "brand",
            }
          : null,
        pipeline: caps.takesOrders
          ? {
              key: "pending_orders",
              label: "Orders Awaiting Action",
              value: data.pending_orders.toLocaleString(),
              icon: <PlugInIcon className="size-5" />,
              tone: data.pending_orders > 0 ? "warning" : "brand",
            }
          : null,
        catalog: caps.catalog
          ? {
              key: "catalog",
              label: caps.products ? "Active Products" : "Active Services",
              value: data.products_count.toLocaleString(),
              icon: <BoxIconLine className="size-5" />,
              tone: "brand",
            }
          : null,
      };

      const sixth = trade.focus.map((k) => focusTile[k]).find((t) => t !== null);
      if (sixth) tiles.push(sixth);
    }
  } else if (caps.keepsBooks) {
    // Books-only: this strip was money OUT only — every tile a way of saying
    // what the business had spent, and not one saying what it had earned. For
    // a Finance Manager tenant, whose entire income is Income rows, that was
    // the whole business missing from its own dashboard. Money in, money out,
    // and what that leaves — in that order, because it is the order the
    // question is asked in.
    const monthTotal = data.expense_breakdown.reduce((sum, slice) => sum + slice.total, 0);
    const weekOut = series.reduce((sum, day) => sum + day.expenses, 0);
    const weekIn = series.reduce((sum, day) => sum + day.other_income, 0);
    const biggest = data.expense_breakdown[0];

    tiles.push({
      key: "income_today",
      label: "Money In Today",
      value: money(today.other_income),
      icon: <DollarLineIcon className="size-5" />,
      tone: "success",
      spark: spark((d) => d.other_income),
    });

    tiles.push({
      key: "month_spend",
      label: "Spent This Month",
      value: money(monthTotal),
      icon: <PieChartIcon className="size-5" />,
      tone: "warning",
      caption: `${data.expense_breakdown.length} ${
        data.expense_breakdown.length === 1 ? "category" : "categories"
      }`,
    });

    // The bottom line, and the reason the other tiles are here. Same figure the
    // Cashbook and the Reports summary print, to the rupee.
    tiles.push({
      key: "net_today",
      label: "Net Today",
      value: money(today.profit),
      delta: today.deltas.profit,
      icon: <PieChartIcon className="size-5" />,
      tone: today.profit < 0 ? "error" : "brand",
      emphasis: true,
      caption: "Money in − money out",
      spark: spark((d) => d.profit),
    });

    if (!compact) {
      tiles.push({
        key: "week_in",
        label: "In, Last 7 Days",
        value: money(weekIn),
        icon: <CalenderIcon className="size-5" />,
        tone: "success",
      });
      tiles.push({
        key: "week_spend",
        label: "Out, Last 7 Days",
        value: money(weekOut),
        icon: <CalenderIcon className="size-5" />,
        tone: "brand",
      });

      if (biggest) {
        tiles.push({
          key: "biggest_category",
          label: "Biggest Category",
          value: money(biggest.total),
          caption: biggest.category,
          icon: <ListIcon className="size-5" />,
          tone: "warning",
        });
      }
    }
  }

  if (tiles.length === 0) return null;

  return (
    <div className={`grid grid-cols-1 gap-4 md:gap-5 ${COLS[Math.min(tiles.length, 6)]}`}>
      {tiles.map(({ key, ...tile }) => (
        <KpiTile key={key} {...tile} />
      ))}
    </div>
  );
}

export function KpiRowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-1 gap-4 md:gap-5 ${COLS[Math.min(count, 6)]}`}>
      {Array.from({ length: count }).map((_, i) => (
        // The tile's OWN skeleton, not a hand-copied one. This used to repeat
        // the padding and the sparkline allowance inline, so the two drifted
        // 4px apart and the strip resized on arrival — the thing the copy was
        // written to prevent.
        <MetricTileSkeleton key={i} />
      ))}
    </div>
  );
}
