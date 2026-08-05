import type { ReactNode } from "react";

import {
  ArrowDownIcon,
  ArrowUpIcon,
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
import { formatDelta } from "./format";

type Tone = "brand" | "success" | "warning" | "error";

const CHIP: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400",
  success: "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
  warning: "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500",
  error: "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500",
};

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
}

type TileSpec = TileProps & { key: string };

function DeltaPill({ delta, invert }: { delta: number | null | undefined; invert?: boolean }) {
  const text = formatDelta(delta);
  if (text === null || delta === null || delta === undefined) return null;

  const up = delta > 0;
  const good = invert ? !up : up;
  // A flat day is real information, but it is neither good nor bad news.
  const tone =
    delta === 0
      ? "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300"
      : good
        ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500"
        : "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500";

  return (
    <span
      title="Compared with yesterday"
      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-theme-xs font-medium tabular-nums ${tone}`}
    >
      {delta !== 0 &&
        (up ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />)}
      {text}
    </span>
  );
}

function KpiTile({ label, value, icon, tone, delta, invertDelta, emphasis, caption }: TileProps) {
  return (
    <div
      className={`rounded-2xl border bg-white p-4 shadow-theme-xs dark:bg-white/[0.03] sm:p-5 ${
        emphasis
          ? "border-brand-500 dark:border-brand-500/60"
          : "border-gray-200 dark:border-gray-800"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${CHIP[tone]}`}
        >
          {icon}
        </span>
        <DeltaPill delta={delta} invert={invertDelta} />
      </div>
      <p
        className={`mt-4 truncate text-xl font-bold tabular-nums sm:text-2xl ${
          emphasis ? "text-brand-600 dark:text-brand-400" : "text-gray-800 dark:text-white/90"
        }`}
        title={value}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-theme-sm text-gray-500 dark:text-gray-400">{label}</p>
      {caption && (
        <p className="mt-0.5 truncate text-theme-xs text-gray-400 dark:text-gray-500" title={caption}>
          {caption}
        </p>
      )}
    </div>
  );
}

/** Column counts per tile count, so a 4-tile books dashboard never leaves gaps. */
const COLS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
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
  const tiles: TileSpec[] = [];

  if (caps.sells) {
    tiles.push({
      key: "revenue",
      label: "Today's Sales",
      value: money(today.revenue),
      delta: today.deltas.revenue,
      icon: <DollarLineIcon className="size-5" />,
      tone: "success",
    });
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
      caption: "Sales − cost of goods − expenses",
    });

    if (!compact) {
      tiles.push({
        key: "orders",
        label: "Orders Today",
        value: today.sales_count.toLocaleString(),
        icon: <TaskIcon className="size-5" />,
        tone: "brand",
      });
      tiles.push({
        key: "customers",
        label: "Customers Today",
        value: today.customers_count.toLocaleString(),
        icon: <GroupIcon className="size-5" />,
        tone: "brand",
      });

      // Sixth tile: whichever number this business actually keeps.
      if (caps.takesOrders) {
        tiles.push({
          key: "pending_orders",
          label: "Orders Awaiting Action",
          value: data.pending_orders.toLocaleString(),
          icon: <PlugInIcon className="size-5" />,
          tone: "warning",
        });
      } else if (caps.tracksStock) {
        tiles.push({
          key: "low_stock",
          label: "Low Stock Items",
          value: data.low_stock_count.toLocaleString(),
          icon: <BoxIconLine className="size-5" />,
          tone: data.low_stock_count > 0 ? "error" : "brand",
        });
      } else if (caps.catalog) {
        tiles.push({
          key: "catalog",
          label: caps.products ? "Active Products" : "Active Services",
          value: data.products_count.toLocaleString(),
          icon: <BoxIconLine className="size-5" />,
          tone: "brand",
        });
      }
    }
  } else if (caps.keepsBooks) {
    // Books-only: the same expense payload, rolled up over the windows it
    // covers — this month (the donut's own total) and the 7-day series.
    const monthTotal = data.expense_breakdown.reduce((sum, slice) => sum + slice.total, 0);
    const weekTotal = data.sales_series.reduce((sum, day) => sum + day.expenses, 0);
    const biggest = data.expense_breakdown[0];

    tiles.push({
      key: "month_spend",
      label: "Spent This Month",
      value: money(monthTotal),
      icon: <PieChartIcon className="size-5" />,
      tone: "brand",
      emphasis: true,
      caption: `${data.expense_breakdown.length} ${
        data.expense_breakdown.length === 1 ? "category" : "categories"
      }`,
    });

    if (!compact) {
      tiles.push({
        key: "week_spend",
        label: "Spent Last 7 Days",
        value: money(weekTotal),
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
        <div
          key={i}
          className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] sm:p-5"
        >
          <div className="flex items-start justify-between">
            <div className="size-10 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
            <div className="h-5 w-14 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
          </div>
          <div className="mt-4 h-7 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="mt-2 h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        </div>
      ))}
    </div>
  );
}
