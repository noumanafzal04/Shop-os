import type { ReactNode } from "react";

interface Props {
  label: string;
  value: string | number;
  icon?: ReactNode;
  hint?: string;
}

/**
 * Dashboard stat card in TailAdmin's visual language.
 */
export function MetricCard({ label, value, icon, hint }: Props) {
  return (
    // `min-w-0` is structural, not cosmetic. A grid or flex item defaults to
    // `min-width: auto`, which means it refuses to be narrower than its own
    // content — so a long money value does not overflow the CARD, it widens the
    // column, then the grid, then the page. That is how the reports screen
    // came to scroll sideways the day a shop's revenue reached seven figures:
    // `Rs 2,358,634.50` needs 181px and the card had 135. Nothing looked
    // broken; the whole page just moved.
    //
    // Same fault as the shell's `flex-1` with no `min-w-0`, and it will keep
    // recurring until every card that holds a number says this.
    <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
          {icon}
        </div>
      )}
      <div className={icon ? "mt-5" : ""}>
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
        {/* `tabular-nums` so a column of figures lines up, and `break-words`
            so the one that still does not fit wraps INSIDE the card rather
            than hanging out of it. */}
        <h4 className="mt-2 font-bold text-gray-800 text-title-sm break-words tabular-nums dark:text-white/90">
          {value}
        </h4>
        {hint && (
          <p className="mt-1 text-theme-xs text-gray-400 dark:text-gray-500">{hint}</p>
        )}
      </div>
    </div>
  );
}

/** Pulsing placeholder matching MetricCard's shape. */
export function MetricCardSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className="h-12 w-12 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
      <div className="mt-5 space-y-3">
        <div className="h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-6 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
      </div>
    </div>
  );
}
