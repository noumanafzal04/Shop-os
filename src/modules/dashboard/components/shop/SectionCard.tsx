import type { ReactNode } from "react";
import { Link } from "react-router";

interface SectionCardProps {
  title: string;
  subtitle?: string;
  /** "View All" target. Omitted when the tenant has no such screen. */
  to?: string;
  toLabel?: string;
  /** Set for tables, which supply their own edge-to-edge padding. */
  flush?: boolean;
  children: ReactNode;
}

/** The white rounded card every dashboard panel sits in. */
export function SectionCard({ title, subtitle, to, toLabel = "View All", flush, children }: SectionCardProps) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
      <header className="flex items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-gray-800 dark:text-white/90">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 truncate text-theme-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
          )}
        </div>
        {to && (
          <Link
            to={to}
            className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-theme-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            {toLabel}
          </Link>
        )}
      </header>
      <div className={flush ? "pb-1" : "px-5 pb-5 sm:px-6 sm:pb-6"}>{children}</div>
    </section>
  );
}

/** Honest "there is nothing here yet" copy — never a fabricated sample row. */
export function EmptyPanel({ message }: { message: string }) {
  return (
    <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-theme-sm text-gray-500 dark:bg-white/[0.02] dark:text-gray-400">
      {message}
    </p>
  );
}

/** Pulsing bar used to build skeletons that match the real layout. */
export function SkeletonBar({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 dark:bg-gray-800 ${className}`} />;
}
