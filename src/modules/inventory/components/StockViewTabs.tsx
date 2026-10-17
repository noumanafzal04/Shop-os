import { FilterTabs } from "../../../components/ui/tabs/FilterTabs";

/** Which part of the stock list is open — also the `?filter=` in the address. */
export type StockView = "all" | "low" | "out";

const VIEWS: Array<{ view: StockView; label: string; short: string; hint: string; tone: string }> = [
  { view: "all", label: "All items", short: "All", hint: "Everything whose stock you count", tone: "bg-white text-gray-700 dark:bg-gray-700 dark:text-gray-200" },
  // The name the help pages and the dashboard already use for this list.
  { view: "low", label: "Needs reordering", short: "Reorder", hint: "At or below its alert level", tone: "bg-warning-100 text-warning-700 dark:bg-warning-500/20 dark:text-warning-400" },
  { view: "out", label: "Out of stock", short: "Out of stock", hint: "None left here", tone: "bg-error-100 text-error-700 dark:bg-error-500/20 dark:text-error-400" },
];

/**
 * THE THREE QUESTIONS A SHOPKEEPER OPENS THIS SCREEN WITH — how much is
 * there, what is running low, what has run out — each a count and a way into
 * its own rows.
 *
 * They were three tiles the width of the page (the user, 2026-10-17: "itne
 * bary box k filters achy ni lgy"). They are the app's one filter bar now,
 * beside the search, with the count on each topic — the same bar Expenses and
 * Pharmacy use, so this screen's filter looks like every other screen's.
 *
 * A count that has not arrived (or could not) is "—", never 0: "0 out of
 * stock" is a claim about the shelf, and a failed request knows nothing about
 * the shelf. A count of nought is grey; a low or gone count that is not is
 * coloured, so a red 3 can be seen without reading the word beside it.
 */
export function StockViewTabs({
  view,
  counts,
  onPick,
}: {
  view: StockView;
  counts: Record<StockView, number | null>;
  onPick: (view: StockView) => void;
}) {
  return (
    <FilterTabs
      label="Show stock"
      value={view}
      onChange={onPick}
      tabs={VIEWS.map((v) => {
        const count = counts[v.view];
        const pill =
          view === v.view
            ? "bg-white/20 text-white"
            : count !== null && count > 0
              ? v.tone
              : "bg-white text-gray-500 dark:bg-gray-700 dark:text-gray-300";

        return {
          key: v.view,
          label: v.label,
          short: v.short,
          hint: v.hint,
          testId: `stock-view-${v.view}`,
          badge: (
            <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-theme-xs font-semibold tabular-nums ${pill}`}>
              {count === null ? "—" : count.toLocaleString()}
            </span>
          ),
        };
      })}
    />
  );
}
