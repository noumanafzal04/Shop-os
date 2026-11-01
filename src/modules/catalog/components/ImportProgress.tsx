import type { ImportProgressSaid } from "../importFile";

/**
 * A LONG IMPORT, IN SIGHT (2026-11-01). Six minutes of a 50,010-row file were
 * a grey line in the corner — "Bringing in part 52 of 101". This is a bar the
 * width of the dialog: the rows in so far out of the whole file, the percent,
 * how long is left at the pace so far, and the one thing a person must not
 * do while it runs.
 */
export function ImportProgress({ p }: { p: ImportProgressSaid }) {
  return (
    <div
      data-testid="import-progress"
      className="mt-4 rounded-xl border border-brand-200 bg-brand-50/60 p-3.5 dark:border-brand-500/30 dark:bg-brand-500/10"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
          {p.doing} {p.rows}
        </span>
        {p.left && <span className="text-theme-xs text-gray-600 dark:text-gray-300">{p.left}</span>}
      </div>
      <div
        role="progressbar"
        aria-label={p.doing === "Checking" ? "Checking the file" : "Bringing the items in"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p.percent}
        aria-valuetext={p.rows}
        className="h-2.5 w-full overflow-hidden rounded-full bg-white dark:bg-white/10"
      >
        <div
          className="h-full rounded-full bg-brand-500 transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${p.percent}%` }}
        />
      </div>
      <p className="mt-2 text-theme-xs text-gray-500 dark:text-gray-400">
        Part {p.part} of {p.parts} · Keep this page open until it finishes.
      </p>
    </div>
  );
}
