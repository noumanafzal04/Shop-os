import type { ReactNode } from "react";

import { ArrowDownIcon, ArrowUpIcon } from "../../../icons";
import { formatDelta } from "./deltaFormat";
import { Sparkline } from "./Sparkline";
import { hasShape } from "./sparkShape";

/**
 * THE ONE NUMBER-TILE BOTH CONSOLES LEAD WITH.
 *
 * The shop dashboard had a tile and the platform dashboard had `KpiTile`, and
 * they were the same design written twice — same chip, same delta pill, same
 * gradient shell, same sparkline underlay. They had already drifted on the
 * value's size and, worse, on the PERCENTAGE ITSELF: one printed "−100%" with a
 * typographic minus rounded to a decimal place, the other "-100.43%" with a
 * hyphen. Two consoles, two answers to one question.
 *
 * ── What changed about the look ────────────────────────────────────────
 *
 * The grey gradient wash is gone. `from-white to-gray-50/70` is the shading
 * every dashboard had in 2019 and it does nothing except make white cards look
 * slightly dirty; a flat ground with one tinted chip reads cleaner and lets the
 * number be the loudest thing on the tile, which is the entire point of a
 * number tile. The figure is larger and tighter, the hover is a small lift
 * rather than a border colour, and the sparkline runs to the card's edges
 * instead of stopping inside its padding.
 */

/** Semantic colouring for the icon chip. Shared with the shop's `tone.ts`. */
export type MetricTone = "brand" | "success" | "warning" | "error" | "gray";

const CHIP: Record<MetricTone, string> = {
  brand: "bg-brand-50 text-brand-600 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:ring-brand-500/25",
  success: "bg-success-50 text-success-600 ring-success-100 dark:bg-success-500/15 dark:text-success-500 dark:ring-success-500/25",
  warning: "bg-warning-50 text-warning-600 ring-warning-100 dark:bg-warning-500/15 dark:text-warning-500 dark:ring-warning-500/25",
  error: "bg-error-50 text-error-600 ring-error-100 dark:bg-error-500/15 dark:text-error-500 dark:ring-error-500/25",
  gray: "bg-gray-50 text-gray-600 ring-gray-200 dark:bg-white/[0.04] dark:text-gray-300 dark:ring-gray-700",
};

const SPARK: Record<MetricTone, string> = {
  brand: "text-brand-500 dark:text-brand-400",
  success: "text-success-500",
  warning: "text-warning-500",
  error: "text-error-500",
  gray: "text-gray-400 dark:text-gray-500",
};

/** The comparison pill. A flat period is real news, but neither good nor bad. */
export function DeltaPill({
  delta,
  invert,
  title,
}: {
  delta: number | null | undefined;
  /** Spending up is bad news, so the colour flips while the arrow does not. */
  invert?: boolean;
  title?: string;
}) {
  const text = formatDelta(delta);
  if (text === null || delta === null || delta === undefined) return null;

  const up = delta > 0;
  const good = invert ? !up : up;
  const tone =
    delta === 0
      ? "bg-gray-100 text-gray-600 ring-gray-200 dark:bg-white/5 dark:text-gray-300 dark:ring-gray-700"
      : good
        ? "bg-success-50 text-success-600 ring-success-100 dark:bg-success-500/15 dark:text-success-500 dark:ring-success-500/25"
        : "bg-error-50 text-error-600 ring-error-100 dark:bg-error-500/15 dark:text-error-500 dark:ring-error-500/25";

  return (
    <span
      title={title}
      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-theme-xs font-semibold tabular-nums ring-1 ${tone}`}
    >
      {delta !== 0 && (up ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />)}
      {text}
    </span>
  );
}

interface MetricTileProps {
  label: string;
  /** Already formatted — money and counts read differently. */
  value: string;
  icon: ReactNode;
  tone?: MetricTone;
  delta?: number | null;
  invertDelta?: boolean;
  /** What the comparison is against, on hover. */
  deltaTitle?: string;
  /** The single figure its strip leads with. */
  emphasis?: boolean;
  caption?: string;
  /**
   * The SAME quantity over time. Never a series from a neighbouring figure: a
   * shape under a number is read as that number's history.
   */
  spark?: number[];
}

export function MetricTile({
  label,
  value,
  icon,
  tone = "brand",
  delta,
  invertDelta,
  deltaTitle,
  emphasis = false,
  caption,
  spark,
}: MetricTileProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-3xl border p-4 shadow-theme-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-theme-md sm:p-5 ${
        // Room for the sparkline to sit under the text rather than through it —
        // and ONLY when one will actually be drawn. Reserving it from the
        // prop's presence alone left an empty strip under the label on a shop
        // whose week was all zeros.
        hasShape(spark) ? "pb-10 sm:pb-11" : ""
      } ${
        emphasis
          ? "border-brand-200 bg-brand-50/60 dark:border-brand-500/40 dark:bg-brand-500/10"
          : "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
      }`}
    >
      {hasShape(spark) && (
        <span aria-hidden className={`pointer-events-none ${SPARK[tone]}`}>
          <Sparkline points={spark} />
        </span>
      )}

      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ${CHIP[tone]}`}>
            {icon}
          </span>
          <DeltaPill delta={delta} invert={invertDelta} title={deltaTitle} />
        </div>

        {/* NO SIZE BUMP FOR EMPHASIS. The emphasised tile stands in the same
            strip as the others, and at six across a larger figure is the one
            that gets truncated — the platform console printed its own headline
            as "Rs 133,…". The tint and the colour carry the emphasis. */}
        <p
          className={`mt-4 truncate text-[1.6rem] font-bold leading-tight tracking-[-0.025em] tabular-nums sm:text-[1.75rem] ${
            emphasis ? "text-brand-600 dark:text-brand-400" : "text-gray-800 dark:text-white/90"
          }`}
          title={value}
        >
          {value}
        </p>

        <p
          title={label}
          // WRAPS RATHER THAN TRUNCATES. A cut label is a figure nobody can
          // name, and these are the numbers both dashboards lead with.
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          className={`mt-2 text-theme-sm leading-snug ${
            emphasis
              ? "font-semibold text-brand-700 dark:text-brand-300"
              : "font-medium text-gray-600 dark:text-gray-300"
          }`}
        >
          {label}
        </p>

        {caption && (
          <p className="mt-0.5 text-theme-xs leading-snug text-gray-500 dark:text-gray-400" title={caption}>
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}

/** Same padding, ground and sparkline allowance as the loaded tile, or the
 *  strip resizes the instant the payload lands. */
export function MetricTileSkeleton() {
  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-4 pb-10 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] sm:p-5 sm:pb-11">
      <div className="size-9 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
      <div className="mt-4 h-7 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      <div className="mt-2.5 h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
    </div>
  );
}
