import type { ReactNode } from "react";
import { Link } from "react-router";

interface PanelProps {
  title: string;
  subtitle?: string;
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
  action,
  aside,
  flush = false,
  className = "",
  children,
}: PanelProps) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-6">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-white/90">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
          )}
        </div>
        {aside}
        {action && (
          <Link
            to={action.to}
            className="text-theme-sm font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {action.label}
          </Link>
        )}
      </div>
      <div className={flush ? "" : "px-5 pb-5 md:px-6 md:pb-6"}>{children}</div>
    </section>
  );
}

/** Nothing to show — say so plainly rather than drawing an empty chart. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="py-10 text-center text-theme-sm text-gray-500 dark:text-gray-400">{children}</p>
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
          className="flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-800"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}
