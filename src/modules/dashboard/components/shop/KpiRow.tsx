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
import { comparedWith, periodKind, periodLabels } from "../../period";
import { pointsPerBar } from "../sparkShape";
import { type Tone } from "./tone";
import { tradeProfile, type FocusKey } from "./trade";

interface TileProps {
  label: string;
  value: string;
  icon: ReactNode;
  tone: Tone;
  /** Signed % against what the period is compared with. Null hides the pill — never prints "0%". */
  delta?: number | null;
  /** What that is, in words, for the pill's hover. */
  deltaTitle?: string;
  /** Spending up is bad news, so its pill colour flips while the arrow doesn't. */
  invertDelta?: boolean;
  emphasis?: boolean;
  caption?: string;
  /** This same figure a point at a time, straight from `sales_series`. */
  spark?: number[];
  /** The series is the figure itself (a period), not the days leading to it. */
  sparkWhole?: boolean;
  featured?: boolean;
}

type TileSpec = TileProps & { key: string };

/**
 * The shop's number tile is `MetricTile`, which the platform console renders
 * too. It used to be a second copy of that design living here, and the copies
 * had drifted — different value sizes, and different percentage formatting.
 */
function KpiTile(props: TileProps) {
  return <MetricTile {...props} />;
}

/** Column counts per tile count, so a 4-tile books dashboard never leaves gaps. */
const COLS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3",
  6: "sm:grid-cols-2 lg:grid-cols-3",
  // Seven is the strip with a refund on it — rare for a day, usual for any
  // period longer than one. Three across left the seventh alone on a row of
  // its own; four and three does not.
  7: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
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
 * books-only shop gets a money-in / money-out strip (its sales figures would
 * all be zero by construction), a shop that sells gets sales/profit/orders.
 *
 * ── Which figures follow the period ────────────────────────────────────
 *
 * Everything that is a FLOW: what was sold, refunded, spent, earned, and how
 * many came. They are read from `data.period` — the dates the server says it
 * answered — and named for it (see period.ts), so a tile can never say
 * "Today's Sales" over last month's figure.
 *
 * The one tile that is a STATE — what is running low, what is waiting — is
 * what it is now, whatever period is being read, and its label has no day in it.
 */
export function KpiRow({ data, caps, money, compact }: Props) {
  const period = data.period;
  const today = period;
  const words = periodLabels(period);
  const trade = tradeProfile(caps.businessType);
  const series = data.sales_series;
  const tiles: TileSpec[] = [];
  const deltaTitle = `Compared with ${comparedWith(period)}`;
  // One day is drawn as the last of the seven that led to it; a run of days
  // is drawn as itself, every point of it part of the figure.
  const oneDay = period.days === 1;

  // A shop on its first day has one point and no direction to draw; the tile
  // then keeps its plain shape rather than reserving room for nothing.
  const spark = (pick: (day: (typeof series)[number]) => number) =>
    series.length > 1 ? series.map(pick) : undefined;
  // What the bars behind the leading figure are, said under it.
  const barsCaption =
    series.length < 2
      ? undefined
      : oneDay
        ? periodKind(period) === "today"
          ? "Last seven days — today solid"
          : "The seven days up to it — this day solid"
        : `Each bar ${barSpan(series.length, period.series.bucket)}`;

  if (caps.sells) {
    tiles.push({
      key: "revenue",
      label: words.sales,
      value: money(today.revenue),
      delta: today.deltas.revenue,
      deltaTitle,
      icon: <DollarLineIcon className="size-5" />,
      tone: "success",
      spark: spark((d) => d.revenue),
      sparkWhole: !oneDay,
      // What the shop is for, and the first thing on the page.
      featured: true,
      caption: barsCaption,
    });

    // Only when the shop actually handed something back. Sales is GROSS — a
    // refund is dated by the day it went out, so netting it into the sales
    // tile would rewrite a day that may already be closed and banked — and
    // without this tile the profit below looks like it was struck from the
    // wrong arithmetic.
    if (today.refunds > 0) {
      tiles.push({
        key: "refunds",
        label: words.refunded,
        value: money(today.refunds),
        icon: <DollarLineIcon className="size-5" />,
        tone: "warning",
        spark: spark((d) => d.refunds),
      });
    }
  }

  // A shop that sells. The books-only strip below says the same figure as
  // "Money Out", in its own order — and used to carry this tile as well, so
  // the one number stood on the row twice under two names.
  if (caps.sells && caps.keepsBooks) {
    tiles.push({
      key: "expenses",
      label: words.expenses,
      value: money(today.expenses),
      delta: today.deltas.expenses,
      deltaTitle,
      invertDelta: true,
      icon: <FileIcon className="size-5" />,
      tone: "warning",
      spark: spark((d) => d.expenses),
    });
  }

  if (caps.sells) {
    tiles.push({
      key: "profit",
      label: words.profit,
      value: money(today.profit),
      delta: today.deltas.profit,
      deltaTitle,
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
        label: words.counted(trade.orders),
        value: today.sales_count.toLocaleString(),
        icon: <TaskIcon className="size-5" />,
        tone: "brand",
      });
      tiles.push({
        key: "customers",
        label: words.counted(trade.customers),
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
    //
    // All three are the PERIOD's. They used to be a day, a month and a week
    // side by side — three windows on one row, because a business that does
    // not sell by the day has little to show for any one of them. It opens on
    // the month now (see ShopDashboard), and can be asked about any other.
    const biggest = data.expense_breakdown[0];

    tiles.push({
      key: "income",
      label: words.moneyIn,
      value: money(today.other_income),
      icon: <DollarLineIcon className="size-5" />,
      tone: "success",
      spark: spark((d) => d.other_income),
      sparkWhole: !oneDay,
      featured: true,
      caption: barsCaption,
    });

    tiles.push({
      key: "spend",
      label: words.moneyOut,
      value: money(today.expenses),
      delta: today.deltas.expenses,
      deltaTitle,
      invertDelta: true,
      icon: <FileIcon className="size-5" />,
      tone: "warning",
      spark: spark((d) => d.expenses),
      caption: `${data.expense_breakdown.length} ${
        data.expense_breakdown.length === 1 ? "category" : "categories"
      }`,
    });

    // The bottom line, and the reason the other tiles are here. Same figure the
    // Cashbook and the Reports summary print, to the rupee.
    tiles.push({
      key: "net",
      label: words.net,
      value: money(today.profit),
      delta: today.deltas.profit,
      deltaTitle,
      icon: <PieChartIcon className="size-5" />,
      tone: today.profit < 0 ? "error" : "brand",
      emphasis: true,
      caption: "Money in − money out",
      spark: spark((d) => d.profit),
    });

    if (!compact && biggest) {
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

  if (tiles.length === 0) return null;

  return (
    <div className={`grid grid-cols-1 gap-4 md:gap-5 ${COLS[Math.min(tiles.length, 7)]}`}>
      {tiles.map(({ key, ...tile }) => (
        <KpiTile key={key} {...tile} />
      ))}
    </div>
  );
}

/**
 * What one bar behind the leading figure stands for: "a day" — or, when the
 * period has more points than the tile has bars for, "3 days".
 */
function barSpan(points: number, bucket: "day" | "week" | "month"): string {
  const each = pointsPerBar(points);

  return each > 1 ? `${each} ${bucket}s` : `a ${bucket}`;
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
