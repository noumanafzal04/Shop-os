import Alert from "../../../components/ui/alert/Alert";
import { useFailedReceipts, useReprintReport } from "../hooks/useReceipts";

/**
 * Copies per cashier.
 *
 * A reprint is not misconduct — customers lose receipts. What it is, is the
 * cheapest way to support a fake return, so the number that matters is not the
 * total but the OUTLIER: one cashier running copies at ten times the rate of
 * everyone else on the same counter.
 *
 * The window arrives already resolved. This tab used to turn the period name
 * into dates itself and started its week on SUNDAY, while every other report on
 * the screen took its week from the server, which starts on Monday — one tab a
 * day out of step with its neighbours, and nothing saying so.
 */
export function ReprintReportTab({ range }: { range: { from: string; to: string } }) {
  const report = useReprintReport(range);
  const failed = useFailedReceipts();

  const rows = [...(report.data?.rows ?? [])].sort((a, b) => b.reprint - a.reprint);
  const totalReprints = rows.reduce((s, r) => s + r.reprint, 0);
  const totalOriginals = rows.reduce((s, r) => s + r.original, 0);
  // Share of receipts that were copies — the one figure worth comparing across
  // cashiers, since a busy lane naturally prints more of everything.
  const shareOf = (r: { original: number; reprint: number; gift: number }) => {
    const all = r.original + r.reprint + r.gift;
    return all === 0 ? 0 : (r.reprint / all) * 100;
  };
  const shopShare = totalOriginals + totalReprints === 0 ? 0 : (totalReprints / (totalOriginals + totalReprints)) * 100;

  return (
    <div className="space-y-6">
      {(failed.data?.length ?? 0) > 0 && (
        <Alert
          variant="warning"
          title={`${failed.data!.length} receipt${failed.data!.length === 1 ? "" : "s"} never printed`}
          message="Open the sale and print it again — the customer left without one."
        />
      )}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-6">
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-white/90">Receipt copies by cashier</h3>
            <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
              {range.from} → {range.to} · {totalReprints} of {totalOriginals + totalReprints} receipts were copies
            </p>
          </div>
        </div>

        {report.isLoading ? (
          <div className="space-y-2 px-5 pb-5 md:px-6 md:pb-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-theme-sm text-gray-500 dark:text-gray-400">
            No receipts printed in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-theme-sm">
              <thead>
                <tr className="border-y border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                  <th className="px-5 py-2.5 font-medium md:px-6">Cashier</th>
                  <th className="px-3 py-2.5 text-right font-medium">Originals</th>
                  <th className="px-3 py-2.5 text-right font-medium">Copies</th>
                  <th className="px-3 py-2.5 text-right font-medium">Gift</th>
                  <th className="px-5 py-2.5 text-right font-medium md:px-6">Copy rate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const share = shareOf(r);
                  // Twice the shop's own rate, on enough copies to mean
                  // something. Not an accusation — a place to look.
                  const flagged = r.reprint >= 5 && share > Math.max(10, shopShare * 2);
                  return (
                    <tr key={r.user_id ?? r.user_name} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                      <td className="px-5 py-3 font-medium text-gray-700 dark:text-gray-300 md:px-6">{r.user_name}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">{r.original}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-gray-800 dark:text-white/90">{r.reprint}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">{r.gift}</td>
                      <td className="px-5 py-3 text-right md:px-6">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-theme-xs font-medium tabular-nums ${
                            flagged
                              ? "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400"
                              : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {share.toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
