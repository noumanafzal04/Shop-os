import { useQuery } from "@tanstack/react-query";

import Badge from "../../../components/ui/badge/Badge";
import { ApiError } from "../../../common/types/api";
import { offlineReportService } from "./offlineReportService";

/**
 * What happened while the shop was offline.
 *
 * ── The one question this answers ───────────────────────────────────────
 *
 * The morning after a power cut, an owner does not want a log. They want to
 * know whether anything is WRONG, and they want it before the shop opens. So
 * the two things that need a person come first and everything else is context:
 *
 *   sales that broke a rule   → a decision (usually: chase the customer)
 *   stock below zero          → a recount, five minutes with a clipboard
 *
 * The count of sales and their value is the reassurance underneath: it went
 * through, it is in the books, nothing was lost.
 *
 * ── Why "nothing happened" is a real answer here ────────────────────────
 *
 * Most days this screen is empty, and an empty screen must say the shop was in
 * touch the whole time rather than leaving an owner wondering whether the
 * report is broken. That sentence is the feature on every day but the bad one.
 */

const money = (n: number) => `Rs ${n.toLocaleString()}`;

const when = (iso: string | null) =>
  iso === null ? "—" : new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "2 days", "6 hours" — how long the till held it. */
function held(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.floor(hours / 24);

  return `${days} day${days === 1 ? "" : "s"}`;
}

export function OfflineReportTab() {
  const report = useQuery({
    queryKey: ["reports", "offline"],
    queryFn: () => offlineReportService.load().then((r) => r.data),
  });

  if (report.isLoading) return <p className="text-theme-sm text-gray-400">Loading…</p>;

  if (report.isError) {
    return (
      <p className="text-theme-sm text-error-500">
        {report.error instanceof ApiError ? report.error.message : "Couldn't load this report."}
      </p>
    );
  }

  const data = report.data;
  const summary = data?.summary;
  const sales = data?.sales ?? [];
  const oversold = data?.oversold ?? [];

  if (!summary || (summary.sales === 0 && oversold.length === 0)) {
    return (
      <div className="rounded-xl border border-success-200 bg-success-50 p-4 dark:border-success-500/30 dark:bg-success-500/10">
        <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
          Nothing came in late
        </p>
        <p className="mt-1 text-theme-xs text-gray-600 dark:text-gray-300">
          Your tills have been in touch the whole time. If the shop trades through a power cut,
          whatever was rung will appear here once the connection returns.
        </p>
      </div>
    );
  }

  // Money that landed against a signed-off day needs a person just as much as
  // a broken rule does — somebody has to post an adjustment, and nothing else
  // on this screen will ever mention it.
  const needsAttention = summary.flagged > 0 || oversold.length > 0 || summary.after_close > 0;

  return (
    <div className="space-y-5">
      {/* What needs a person, first. Everything else is context. */}
      <div
        className={`rounded-xl border p-4 ${
          needsAttention
            ? "border-warning-200 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/10"
            : "border-success-200 bg-success-50 dark:border-success-500/30 dark:bg-success-500/10"
        }`}
      >
        <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
          {needsAttention
            ? "Some of this needs a look"
            : "Everything that came in late went through cleanly"}
        </p>
        <p className="mt-1 text-theme-xs text-gray-600 dark:text-gray-300">
          {summary.sales.toLocaleString()} {summary.sales === 1 ? "sale" : "sales"} worth{" "}
          {money(summary.total)} were rung while a till was out of contact, and are now in your
          books against the day they actually happened.
        </p>
      </div>

      {summary.after_close > 0 && (
        <div className="rounded-xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/10">
          <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
            {money(summary.after_close_total)} arrived after those days were closed
          </p>
          <p className="mt-1 text-theme-xs text-gray-600 dark:text-gray-300">
            {summary.after_close === 1 ? "One sale" : `${summary.after_close} sales`} reached us
            after you had already counted the drawer, closed the day and banked the cash. Those
            days have not been changed — a day you have signed off stays as you signed it — so
            their takings now read {money(summary.after_close_total)} short of their sales. The
            sales themselves are in your books against the right day.
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Sales", summary.sales.toLocaleString()],
          ["Value", money(summary.total)],
          ["Need a decision", summary.flagged.toLocaleString()],
          ["Need a recount", oversold.length.toLocaleString()],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
            <dt className="text-theme-xs text-gray-400">{label}</dt>
            <dd className="mt-0.5 text-theme-sm font-medium tabular-nums text-gray-800 dark:text-white/90">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {oversold.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
            Count these again
          </h3>
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">
            Two tills with no connection can each sell the last one, and both are telling the
            truth — the goods really did leave. Nothing here is a mistake; the shelf simply needs
            counting.
          </p>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-theme-sm">
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {oversold.map((row, i) => (
                  <tr key={`${row.sku ?? row.product}-${i}`}>
                    <td className="p-3 text-gray-800 dark:text-white/90">
                      {row.product ?? "Unnamed item"}
                      {row.sku && <span className="text-gray-400"> · {row.sku}</span>}
                    </td>
                    <td className="p-3 text-gray-400">{row.branch}</td>
                    <td className="p-3 text-right font-medium tabular-nums text-error-500">
                      {row.quantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {sales.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
            What came in late
          </h3>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-theme-sm">
              <thead className="text-left text-theme-xs text-gray-400">
                <tr>
                  <th className="p-3 font-normal">Sale</th>
                  <th className="p-3 font-normal">Rung</th>
                  <th className="p-3 font-normal">Held</th>
                  <th className="p-3 font-normal">Till</th>
                  <th className="p-3 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="p-3">
                      <div className="text-gray-800 dark:text-white/90">{sale.invoice_number}</div>
                      {/* The slip the customer is holding — the only reference
                          they have, so it is on screen next to the real one. */}
                      {sale.offline_number && (
                        <div className="text-theme-xs text-gray-400">
                          slip {sale.offline_number}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {sale.violations.map((v) => (
                          <Badge key={v} size="sm" color="warning">
                            {v}
                          </Badge>
                        ))}
                        {sale.beyond_window && (
                          <Badge size="sm" color="light">
                            Past the offline window
                          </Badge>
                        )}
                        {sale.after_close && (
                          <Badge size="sm" color="light">
                            After the day was closed
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-gray-500 dark:text-gray-400">{when(sale.sold_at)}</td>
                    <td className="p-3 text-gray-500 dark:text-gray-400">{held(sale.held_hours)}</td>
                    <td className="p-3 text-gray-500 dark:text-gray-400">
                      {sale.till ?? "Unknown till"}
                      {sale.register && <span className="text-gray-400"> · {sale.register}</span>}
                    </td>
                    <td className="p-3 text-right font-medium tabular-nums text-gray-800 dark:text-white/90">
                      {money(sale.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
