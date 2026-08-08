import type { ReactNode } from "react";
import { Link } from "react-router";

import { AngleRightIcon } from "../../../../icons";

interface PanelProps {
  title: string;
  subtitle?: string;
  /**
   * A glyph for the header chip. Panels that carry one read as a set with the
   * KPI strip above them, which is the only reason it exists.
   */
  icon?: ReactNode;
  /** Optional "View All" target — must be a route that exists. */
  action?: { label: string; to: string };
  /** Header-right controls (period toggles and the like). */
  aside?: ReactNode;
  /** Tables manage their own cell padding and horizontal scroll. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Panel({
  title,
  subtitle,
  icon,
  action,
  aside,
  flush = false,
  className = "",
  children,
}: PanelProps) {
  return (
    <section
      className={`group/panel overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-gray-700 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-6 md:pt-5">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:ring-brand-500/20">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate font-semibold tracking-tight text-gray-800 dark:text-white/90">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
            )}
          </div>
        </div>
        {aside}
        {action && (
          <Link
            to={action.to}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-theme-xs font-medium text-gray-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/10 dark:hover:text-brand-400"
          >
            {action.label}
            {/* The arrow steps out on hover so the pill reads as a door, not a tag. */}
            <AngleRightIcon className="size-3.5 transition-transform duration-200 group-hover/panel:translate-x-0.5" />
          </Link>
        )}
      </div>
      <div className={flush ? "" : "px-5 pb-5 md:px-6 md:pb-6"}>{children}</div>
    </section>
  );
}

/**
 * Nothing to show — say so plainly rather than drawing an empty chart.
 *
 * Drawn as a deliberate dashed plate: an empty panel that looks unfinished
 * reads as a bug, and an operator who thinks the console is broken stops
 * trusting the figures that ARE there.
 */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-8 text-center dark:border-gray-700 dark:bg-white/[0.02]">
      <span
        aria-hidden
        className="mb-3 flex size-10 items-center justify-center rounded-full bg-white text-gray-400 ring-1 ring-gray-200 dark:bg-white/[0.04] dark:text-gray-500 dark:ring-gray-700"
      >
        <svg viewBox="0 0 20 20" fill="none" className="size-5">
          <path
            d="M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5v-7Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M3.5 6.5 10 10m0 0 6.5-3.5M10 10v7" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </span>
      <p className="text-theme-sm text-gray-600 dark:text-gray-300">{children}</p>
    </div>
  );
}

/** Pulsing block used by every panel's loading state. */
export function Pulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 dark:bg-gray-800 ${className}`} />;
}

/** Chart placeholder shaped like a plot, so the layout does not jump on load. */
export function ChartPulse({ height }: { height: number }) {
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {[62, 78, 45, 88, 55, 70, 40, 82, 60, 74].map((h, i) => (
        <div
          key={i}
          className="flex-1 animate-pulse rounded-t-lg bg-gray-200 dark:bg-gray-800"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

/**
 * A headline figure above a chart. The console's job is money and growth, and
 * a plot alone makes the reader estimate a number the panel already knows.
 */
export function PanelStat({
  value,
  caption,
  aside,
}: {
  value: string;
  caption: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-2xl font-bold tabular-nums tracking-tight text-gray-800 dark:text-white/90 sm:text-3xl">
          {value}
        </p>
        <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{caption}</p>
      </div>
      {aside}
    </div>
  );
}

/** The chip a chart's own key is drawn from — colour, name, and its figure. */
export function LegendChip({
  color,
  label,
  value,
  title,
}: {
  color: string;
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-theme-xs text-gray-600 ring-1 ring-gray-200 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-800"
    >
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {label}
      <span className="font-semibold tabular-nums text-gray-800 dark:text-white/90">{value}</span>
    </span>
  );
}
