import type { ReactNode } from "react";

import { Surface, SurfaceEmpty, SurfacePulse } from "../Surface";

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

/**
 * The platform console's card — a shell over `Surface`, which the shop
 * console's `SectionCard` also renders.
 *
 * They used to be two copies of one design, and copies drift: these had
 * already separated on padding and, more quietly, on the BREAKPOINT that
 * padding stepped at — `md` here against `sm` there — so between 640px and
 * 768px the two consoles were visibly different products.
 */
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
    <Surface
      title={title}
      subtitle={subtitle}
      icon={icon}
      action={action}
      aside={aside}
      flush={flush}
      className={className}
    >
      {children}
    </Surface>
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
  return <SurfaceEmpty message={children} />;
}

/** Pulsing block used by every panel's loading state. */
export function Pulse({ className = "" }: { className?: string }) {
  return <SurfacePulse className={className} />;
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
