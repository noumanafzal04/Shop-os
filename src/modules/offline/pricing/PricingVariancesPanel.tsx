import { useQuery } from "@tanstack/react-query";

import Badge from "../../../components/ui/badge/Badge";
import { ApiError } from "../../../common/types/api";
import { describe, groupVariances, type VarianceGroup } from "./groupVariances";
import { varianceService, type ReportedVariance } from "./varianceService";
import { SKIP_CONCERN, verdict } from "./verdict";

/**
 * Whether this shop's tills can be trusted to price on their own.
 *
 * Before a till is allowed to sell with no server, every completed sale is
 * priced a SECOND time by the offline engine and the two answers compared. The
 * customer pays the server's price either way — this screen is the evidence
 * being gathered underneath.
 *
 * ── Why the count of findings is never shown on its own ─────────────────
 *
 * "No disagreements" is produced identically by two very different shops:
 *
 *   the engine agreed on 1,284 real carts    ← ready
 *   no till ever checked anything            ← not ready, and looks identical
 *
 * The second is the quieter of the two — nothing to see is exactly what it
 * looks like — so the number of CHECKS is given the headline and the number of
 * findings reads against it. A shop that has checked nothing is told so plainly
 * rather than shown a clean sheet it did not earn.
 */

const money = (n: number) => `Rs ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const when = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Whole days between then and now. */
function daysSince(iso: string | null): number | null {
  if (iso === null) return null;

  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function PricingVariancesPanel() {
  const report = useQuery({
    queryKey: ["pricing-variances"],
    queryFn: () => varianceService.list().then((r) => r.data),
  });

  if (report.isLoading) return <p className="text-theme-sm text-gray-400">Loading…</p>;

  if (report.isError) {
    return (
      <p className="text-theme-sm text-error-500">
        {report.error instanceof ApiError ? report.error.message : "Couldn't load the pricing checks."}
      </p>
    );
  }

  const checks = report.data?.checks ?? {
    checked: 0, matched: 0, skipped: 0, differed: 0, tills: 0, reporting: 0, since: null,
  };
  const total = report.data?.total ?? 0;
  const variances = report.data?.variances ?? [];
  const groups = groupVariances(variances);
  const state = verdict(checks, total);
  const days = daysSince(checks.since);
  const skipShare = checks.checked === 0 ? 0 : checks.skipped / checks.checked;

  const tone = {
    success: "border-success-200 bg-success-50 dark:border-success-500/30 dark:bg-success-500/10",
    warning: "border-warning-200 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/10",
    error: "border-error-200 bg-error-50 dark:border-error-500/30 dark:bg-error-500/10",
  }[state.tone];

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${tone}`}>
        <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{state.headline}</p>
        <p className="mt-1 text-theme-xs text-gray-600 dark:text-gray-300">{state.detail}</p>
      </div>

      {/* The denominator, always — never the finding count on its own. */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Carts checked", checks.checked.toLocaleString()],
          ["Matched exactly", checks.matched.toLocaleString()],
          ["Couldn't be priced", checks.skipped.toLocaleString()],
          ["Tills reporting", `${checks.reporting} of ${checks.tills}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
            <dt className="text-theme-xs text-gray-400">{label}</dt>
            <dd className="mt-0.5 text-theme-sm font-medium tabular-nums text-gray-800 dark:text-white/90">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {checks.since !== null && (
        <p className="text-theme-xs text-gray-400">
          Counting since {when(checks.since)}
          {days !== null && days > 0 && ` — ${days} day${days === 1 ? "" : "s"}`}. A till whose browser
          data is cleared starts again from zero, so this figure can go down as well as up.
        </p>
      )}

      {checks.reporting > 0 && checks.reporting < checks.tills && (
        <p className="text-theme-xs text-warning-600 dark:text-warning-400">
          Only {checks.reporting} of your {checks.tills} tills has checked anything. The others have not
          been exercised, so this evidence does not cover them.
        </p>
      )}

      {skipShare > SKIP_CONCERN && (
        <p className="text-theme-xs text-warning-600 dark:text-warning-400">
          {Math.round(skipShare * 100)}% of carts couldn't be priced locally at all — usually an item the
          till had not downloaded yet. A skip is not a match, and this needs to come down before the
          figures above mean much.
        </p>
      )}

      {groups.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
            {groups.length === 1 ? "What went wrong" : `${groups.length} things went wrong`}
          </h3>
          {/* Grouped, because nine rows saying the same thing are ONE finding.
              Listed one per cart, a reader has to compare nine blocks of
              numbers before noticing there is only one defect — and a shop
              trading all day would produce nine hundred. */}
          <div className="space-y-2">
            {groups.map((group) => (
              <GroupCard key={group.key} group={group} />
            ))}
          </div>
        </section>
      )}

      {total > variances.length && (
        <p className="text-theme-xs text-gray-400">
          Grouped from the newest {variances.length} of {total.toLocaleString()} disagreements.
        </p>
      )}
    </div>
  );
}

/**
 * One finding, with its carts folded away.
 *
 * Collapsed by default. The count and the sentence are what an owner needs;
 * the individual carts are what a developer needs to reproduce it, and putting
 * the second in front of the first buries the answer under the evidence.
 */
function GroupCard({ group }: { group: VarianceGroup }) {
  const range =
    group.smallest === group.largest
      ? money(group.largest)
      : `${money(group.smallest)}–${money(group.largest)}`;

  return (
    <details className="rounded-xl border border-gray-200 dark:border-gray-800">
      <summary className="cursor-pointer list-none p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
              {describe(group)}
            </p>
            <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
              {group.count} {group.count === 1 ? "cart" : "carts"} · off by {range} · fields:{" "}
              {group.fields.join(", ")}
            </p>
          </div>
          <Badge size="sm" color="warning">
            ×{group.count}
          </Badge>
        </div>
      </summary>

      <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
        {group.examples.slice(0, EXAMPLES).map((v) => (
          <VarianceRow key={v.id} variance={v} />
        ))}
        {group.count > EXAMPLES && (
          <p className="p-3 text-theme-xs text-gray-400">
            {group.count - EXAMPLES} more like these. They are the same finding — fixing one fixes
            all of them.
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * How many carts are shown inside a group.
 *
 * A handful is enough to reproduce a defect; the rest are the same finding
 * again, and printing all of them is how the pattern gets buried under its own
 * evidence.
 */
const EXAMPLES = 5;

/** One disagreement, in the terms a developer would need to reproduce it. */
function VarianceRow({ variance }: { variance: ReportedVariance }) {
  return (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <Badge size="sm" color="light">
          {variance.device?.name ?? "Unknown till"}
        </Badge>
        <span className="text-theme-xs text-gray-400">
          {variance.found_at === null ? "—" : new Date(variance.found_at).toLocaleString()}
        </span>
      </div>

      <ul className="mt-2 space-y-1">
        {variance.differences.map((d) => (
          <li key={d.field} className="text-theme-xs text-gray-600 dark:text-gray-300">
            <span className="font-medium capitalize">{d.field}</span>: server {money(d.server)}, till{" "}
            {money(d.local)}{" "}
            <span className="text-error-500 tabular-nums">
              ({d.by > 0 ? "+" : ""}
              {money(d.by)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
