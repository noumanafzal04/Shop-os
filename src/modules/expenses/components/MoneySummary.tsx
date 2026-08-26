import { formatRange, type DateRange } from "../../../components/ui/filters";
import type { MoneyTotals } from "../services/moneyFilters";

/**
 * What the slice of the book on screen comes to.
 *
 * This used to be two lines of grey caption text tucked under the search box —
 * "1096 entries" beside "Rs 4,678,156", both at 12px, both the same weight as
 * the placeholder above them. It is the answer to the question the filter just
 * asked, and it was drawn like a footnote.
 *
 * Three figures, because three different questions get brought to a books
 * page and each needs a different one: how much went out, how many times, and
 * how big a typical one is. The average is the one that catches a mis-keyed
 * amount — a shop that averages Rs 3,000 a bill and suddenly averages
 * Rs 30,000 has a stray zero in the month somewhere.
 *
 * Nothing here is fetched. All three come out of `meta.totals`, which the
 * server already sends beside the rows, so the strip cannot disagree with the
 * table under it.
 */
export function MoneySummary({
  totals,
  money,
  direction,
  range,
  filtered,
  loading = false,
}: {
  totals?: MoneyTotals;
  money: (n: string | number) => string;
  /** `out` tints the total like a cost; `in` like a receipt. */
  direction: "in" | "out";
  range: DateRange;
  /** Whether anything narrows the set — it changes what the caption can claim. */
  filtered: boolean;
  loading?: boolean;
}) {
  const count = totals?.count ?? 0;
  const total = totals?.total ?? 0;
  // A count of zero must not divide. An empty book averages nothing, and "Rs 0"
  // is a claim about typical spend that is not true.
  const average = count > 0 ? total / count : null;

  const heading = direction === "out" ? "Total out" : "Total in";
  const tint =
    direction === "out"
      ? "text-gray-900 dark:text-white"
      : "text-success-600 dark:text-success-500";

  return (
    <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 sm:grid-cols-4 dark:border-gray-800 dark:bg-gray-800">
      <Figure label={heading} className="col-span-2 sm:col-span-2">
        {loading ? (
          <Bar wide />
        ) : (
          <p className={`text-2xl font-semibold tabular-nums ${tint}`}>{money(total)}</p>
        )}
        <p className="mt-1 text-theme-xs text-gray-400">
          {/* What set this describes. A total with no scope printed beside it
              is the number people mistrust — and rightly. */}
          {formatRange(range)}
          {filtered ? " · filtered" : ""}
        </p>
      </Figure>

      <Figure label="Entries">
        {loading ? <Bar /> : (
          <p className="text-lg font-semibold tabular-nums text-gray-800 dark:text-white/90">
            {count.toLocaleString()}
          </p>
        )}
      </Figure>

      <Figure label="Average">
        {loading ? <Bar /> : (
          <p className="text-lg font-semibold tabular-nums text-gray-800 dark:text-white/90">
            {average === null ? "—" : money(average)}
          </p>
        )}
      </Figure>
    </div>
  );
}

function Figure({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white p-4 dark:bg-gray-900 ${className}`}>
      <p className="mb-1 text-theme-xs uppercase tracking-wide text-gray-400">{label}</p>
      {children}
    </div>
  );
}

const Bar = ({ wide = false }: { wide?: boolean }) => (
  <div className={`h-7 animate-pulse rounded bg-gray-100 dark:bg-gray-800 ${wide ? "w-48" : "w-20"}`} />
);
