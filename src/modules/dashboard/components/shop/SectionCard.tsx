import type { ReactNode } from "react";
import { Link } from "react-router";

import { AngleRightIcon } from "../../../../icons";

interface SectionCardProps {
  title: string;
  subtitle?: string;
  /**
   * A glyph for the card's header chip. Panels that carry one read as a set
   * with the KPI strip above them, which is the only reason it exists.
   */
  icon?: ReactNode;
  /** "View All" target. Omitted when the tenant has no such screen. */
  to?: string;
  toLabel?: string;
  /** Set for tables, which supply their own edge-to-edge padding. */
  flush?: boolean;
  children: ReactNode;
}

/** The rounded card every dashboard panel sits in. */
export function SectionCard({
  title,
  subtitle,
  icon,
  to,
  toLabel = "View All",
  flush,
  children,
}: SectionCardProps) {
  return (
    <section className="group/card overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-gray-700">
      <header className="flex items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
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
              <p className="mt-0.5 truncate text-theme-xs text-gray-500 dark:text-gray-400">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {to && (
          <Link
            to={to}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-theme-xs font-medium text-gray-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 dark:border-gray-700 dark:bg-transparent dark:text-gray-300 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/10 dark:hover:text-brand-400"
          >
            {toLabel}
            {/* The arrow steps out on hover so the pill reads as a door, not a tag. */}
            <AngleRightIcon className="size-3.5 transition-transform duration-200 group-hover/card:translate-x-0.5" />
          </Link>
        )}
      </header>
      <div className={flush ? "pb-1" : "px-5 pb-5 sm:px-6 sm:pb-6"}>{children}</div>
    </section>
  );
}

/**
 * Honest "there is nothing here yet" copy — never a fabricated sample row.
 *
 * Drawn as a deliberate dashed plate rather than a bare sentence on grey: an
 * empty panel that looks unfinished reads as a bug, and a shopkeeper who thinks
 * the dashboard is broken stops trusting the figures that ARE there.
 */
export function EmptyPanel({ message, hint }: { message: string; hint?: string }) {
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
      <p className="text-theme-sm text-gray-600 dark:text-gray-300">{message}</p>
      {hint && <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

/** Pulsing bar used to build skeletons that match the real layout. */
export function SkeletonBar({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 dark:bg-gray-800 ${className}`} />;
}

/**
 * A panel-shaped placeholder. The loaded page always draws at least one card
 * below the strip (Attention needed has no module gate), so leaving this out
 * made the whole page jump upward the moment the payload landed.
 */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="flex items-center gap-3">
        <SkeletonBar className="size-9 rounded-xl" />
        <SkeletonBar className="h-4 w-36" />
      </div>
      <div className="mt-5 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonBar key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </section>
  );
}
