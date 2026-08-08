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
import { Sparkline } from "../Sparkline";
import { TONE_TEXT, type Tone } from "./tone";
import { tradeProfile, type FocusKey } from "./trade";

/** Icon chip per tone — tinted ground, matching ring, matching glyph. */
const CHIP: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-600 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:ring-brand-500/25",
  success: "bg-success-50 text-success-600 ring-success-100 dark:bg-success-500/15 dark:text-success-500 dark:ring-success-500/25",
  warning: "bg-warning-50 text-warning-600 ring-warning-100 dark:bg-warning-500/15 dark:text-warning-500 dark:ring-warning-500/25",
  error: "bg-error-50 text-error-600 ring-error-100 dark:bg-error-500/15 dark:text-error-500 dark:ring-error-500/25",
  gray: "bg-gray-50 text-gray-600 ring-gray-200 dark:bg-white/[0.04] dark:text-gray-300 dark:ring-gray-700",
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
  /** Last 7 days of this same figure, straight from `sales_series`. */
  spark?: number[];
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
      ? "bg-gray-100 text-gray-600 ring-gray-200 dark:bg-white/5 dark:text-gray-300 dark:ring-gray-700"
      : good
        ? "bg-success-50 text-success-600 ring-success-100 dark:bg-success-500/15 dark:text-success-500 dark:ring-success-500/25"
        : "bg-error-50 text-error-600 ring-error-100 dark:bg-error-500/15 dark:text-error-500 dark:ring-error-500/25";

  return (
    <span
      title="Compared with yesterday"
      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-theme-xs font-semibold tabular-nums ring-1 ${tone}`}
    >
      {delta !== 0 &&
        (up ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />)}
      {text}
    </span>
  );
}

function KpiTile({ label, value, icon, tone, delta, invertDelta, emphasis, caption, spark }: TileProps) {
  return (
    <div
      // The one figure the strip exists for gets a ground of its own, not just a
      // heavier border — a border alone is invisible in a row of six cards. The
      // rest get a whisper of the same treatment so the strip reads as one set.
      className={`relative overflow-hidden rounded-2xl border p-4 shadow-theme-xs transition-all duration-200 hover:shadow-theme-md sm:p-5 ${
        spark ? "pb-9 sm:pb-10" : ""
      } ${
        emphasis
          ? "border-brand-200 bg-gradient-to-br from-brand-50 via-white to-brand-50/40 hover:border-brand-300 dark:border-brand-500/40 dark:from-brand-500/15 dark:via-white/[0.03] dark:to-brand-500/5 dark:hover:border-brand-500/60"
          : "border-gray-200 bg-gradient-to-b from-white to-gray-50/70 hover:border-gray-300 dark:border-gray-800 dark:from-white/[0.045] dark:to-white/[0.02] dark:hover:border-gray-700"
      }`}
    >
      {spark && (
        <span aria-hidden className={`pointer-events-none ${TONE_TEXT[tone]}`}>
          <Sparkline points={spark} />
        </span>
      )}

      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ${CHIP[tone]}`}
          >
            {icon}
          </span>
          <DeltaPill delta={delta} invert={invertDelta} />
        </div>
        <p
          className={`mt-4 truncate font-bold tabular-nums tracking-tight ${
            emphasis
              ? "text-2xl text-brand-600 dark:text-brand-400 sm:text-3xl"
              : "text-xl text-gray-800 dark:text-white/90 sm:text-2xl"
          }`}
          title={value}
        >
          {value}
        </p>
        <p
          className={`mt-1 truncate text-theme-sm ${
            emphasis ? "font-semibold text-brand-700 dark:text-brand-300" : "font-medium text-gray-600 dark:text-gray-300"
          }`}
        >
          {label}
        </p>
        {caption && (
          <p className="mt-0.5 truncate text-theme-xs text-gray-500 dark:text-gray-400" title={caption}>
            {caption}
          </p>
        )}
      </div>
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
      caption: "Sales − cost of goods − expenses",
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
        <div
          key={i}
          // Same padding, same ground, same corner as the loaded tile — including
          // the sparkline's bottom allowance, or the strip resizes on arrival.
          className="rounded-2xl border border-gray-200 bg-white p-4 pb-9 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] sm:p-5 sm:pb-10"
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
