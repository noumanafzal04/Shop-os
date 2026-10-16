/** Which part of the stock list is open — also the `?filter=` in the address. */
export type StockView = "all" | "low" | "out";

const TILES: Array<{ view: StockView; label: string; hint: string; dot: string; tone: string }> = [
  { view: "all", label: "All items", hint: "Everything you keep", dot: "bg-brand-500", tone: "text-gray-800 dark:text-white/90" },
  // The name the help pages and the dashboard already use for this list.
  { view: "low", label: "Needs reordering", hint: "At or below its alert level", dot: "bg-warning-500", tone: "text-warning-600 dark:text-warning-400" },
  { view: "out", label: "Out of stock", hint: "None left here", dot: "bg-error-500", tone: "text-error-600 dark:text-error-400" },
];

/**
 * THE THREE QUESTIONS A SHOPKEEPER OPENS THIS SCREEN WITH — how much is
 * there, what is running low, what has run out — answered before the list,
 * and each one a way into its own rows.
 *
 * A count that has not arrived (or could not) is "—", never 0: "0 out of
 * stock" is a claim about the shelf, and a failed request knows nothing about
 * the shelf.
 */
export function StockTiles({
  view,
  counts,
  onPick,
}: {
  view: StockView;
  counts: Record<StockView, number | null>;
  onPick: (view: StockView) => void;
}) {
  return (
    <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3" role="group" aria-label="Show stock">
      {TILES.map((t) => {
        const on = view === t.view;
        const count = counts[t.view];

        return (
          <button
            key={t.view}
            type="button"
            aria-pressed={on}
            data-testid={`stock-tile-${t.view}`}
            onClick={() => onPick(t.view)}
            className={`rounded-2xl border bg-white p-3 text-left transition focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:p-4 dark:bg-white/[0.03] ${
              on
                ? "border-brand-500 ring-1 ring-brand-500"
                : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
            }`}
          >
            {/* Wraps rather than cuts: "Needs reor…" on a phone named nothing. */}
            <span className="flex items-start gap-1.5 text-theme-xs font-medium leading-tight text-gray-500 dark:text-gray-400">
              <span className={`mt-1 size-2 shrink-0 rounded-full ${t.dot}`} aria-hidden="true" />
              <span>{t.label}</span>
            </span>
            <span
              className={`mt-1 block text-xl font-semibold tabular-nums sm:text-2xl ${
                count !== null && count > 0 ? t.tone : "text-gray-800 dark:text-white/90"
              }`}
            >
              {count === null ? "—" : count.toLocaleString()}
            </span>
            <span className="mt-0.5 hidden text-theme-xs text-gray-400 sm:block dark:text-gray-500">{t.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
