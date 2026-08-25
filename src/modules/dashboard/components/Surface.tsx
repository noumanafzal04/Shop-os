import type { ReactNode } from "react";
import { Link } from "react-router";

import { AngleRightIcon } from "../../../icons";

/**
 * THE ONE CARD BOTH DASHBOARDS ARE MADE OF.
 *
 * The shop console had `SectionCard` and the platform console had `Panel`, and
 * they were the same component written twice: same shell, same header, same
 * "View All" pill, same dashed empty plate, same pulse. Two copies of one
 * design do not stay one design — these had already drifted on padding
 * (`pb-4 pt-5` against `py-4`) and, more quietly, on BREAKPOINT: one grew its
 * padding at `sm`, the other at `md`, so between 640px and 768px the two
 * consoles were visibly different products.
 *
 * Both now render this. The wrappers stay, because their prop shapes differ in
 * ways their callers depend on — `to`/`toLabel` against `action` — and
 * rewriting forty call sites to unify two words is a bigger change than the
 * one being made here.
 */
interface SurfaceProps {
  title: string;
  subtitle?: string;
  /**
   * A glyph for the header chip. Panels that carry one read as a set with the
   * KPI strip above them, which is the only reason it exists.
   */
  icon?: ReactNode;
  /** The door out of this card, when there is a screen behind it. */
  action?: { label: string; to: string };
  /** Header-right controls — period toggles and the like. */
  aside?: ReactNode;
  /** Tables supply their own edge-to-edge padding. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Surface({
  title,
  subtitle,
  icon,
  action,
  aside,
  flush = false,
  className = "",
  children,
}: SurfaceProps) {
  return (
    <section
      className={`group/surface overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-theme-xs transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-gray-700 ${className}`}
    >
      {/* ONE padding scale, and it steps at `sm` in both consoles. */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6 sm:py-5 dark:border-white/[0.06]">
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
              <p className="mt-0.5 text-theme-xs leading-snug text-gray-500 dark:text-gray-400">
                {subtitle}
              </p>
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
            {/* ONE group name, written out. `group/${name}` would be a class
                Tailwind never sees — it scans source text, so an interpolated
                class is simply not generated and the arrow quietly stops
                moving. Nothing nests these, so one name is enough. */}
            <AngleRightIcon className="size-3.5 transition-transform duration-200 group-hover/surface:translate-x-0.5" />
          </Link>
        )}
      </header>
      <div className={flush ? "pb-1" : "px-5 py-5 sm:px-6 sm:py-6"}>{children}</div>
    </section>
  );
}

/**
 * Nothing to show — said plainly, never a fabricated sample row.
 *
 * Drawn as a deliberate dashed plate rather than a bare sentence on grey: an
 * empty panel that looks unfinished reads as a bug, and somebody who thinks the
 * console is broken stops trusting the figures that ARE there.
 */
export function SurfaceEmpty({ message, hint }: { message: ReactNode; hint?: string }) {
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

/** The pulsing block every loading state on both consoles is built from. */
export function SurfacePulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 dark:bg-gray-800 ${className}`} />;
}
