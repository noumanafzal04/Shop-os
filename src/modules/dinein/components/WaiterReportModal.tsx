import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "../../../components/ui/modal";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { useMoney } from "../../shop/hooks/useShop";
import { dineInService } from "../services/dineInService";

/**
 * How each section did.
 *
 * A restaurant owner's evening question is "who is actually turning tables",
 * and the answer was computed on the server and reachable by nobody. Sorted by
 * takings, because that is the column being asked about; open tabs are flagged
 * because a waiter still holding four tables has not finished yet and their
 * row is not final.
 *
 * Tips are shown apart from sales and never added into them — that money is
 * the staff's, not the shop's, and a total that blurs the two is the one an
 * argument starts over.
 */
export default function WaiterReportModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const money = useMoney();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const report = useQuery({
    queryKey: ["dinein", "waiter-report", from, to],
    queryFn: async () => (await dineInService.waiterReport({ from, to })).data,
    enabled: isOpen,
  });

  const rows = report.data?.rows ?? [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-3xl p-6">
      <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Waiter sections</h3>
      <p className="mb-5 text-theme-sm text-gray-500 dark:text-gray-400">
        Tables run, what they took, and what was tipped. Tips are the staff&rsquo;s and are never counted into sales.
      </p>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="max-w-[11rem]" />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-[11rem]" />
        </div>
      </div>

      {report.isPending ? (
        <div className="h-40 animate-pulse rounded-xl bg-gray-100 dark:bg-white/5" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center dark:border-gray-700">
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">No tables were run in that period.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-theme-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="py-2.5 pr-3 font-medium">Waiter</th>
                <th className="px-3 py-2.5 text-right font-medium">Tables</th>
                <th className="px-3 py-2.5 text-right font-medium">Covers</th>
                <th className="px-3 py-2.5 text-right font-medium">Bills</th>
                <th className="px-3 py-2.5 text-right font-medium">Sales</th>
                <th className="py-2.5 pl-3 text-right font-medium">Tips</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.waiter_id} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                  <td className="py-3 pr-3">
                    <span className="text-gray-800 dark:text-white/90">{r.waiter_name}</span>
                    {r.open_tabs > 0 && (
                      <span className="ml-2 rounded-full bg-warning-50 px-2 py-0.5 text-theme-xs font-medium text-warning-700 dark:bg-warning-500/10 dark:text-warning-400">
                        {r.open_tabs} still open
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{r.tables}</td>
                  {/* An honest gap beats a guessed average — guest count is
                      optional when a tab is opened. */}
                  <td className="px-3 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                    {r.covers > 0 ? r.covers : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">{r.sales_count}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums text-gray-800 dark:text-white/90">
                    {money(r.sales_total)}
                  </td>
                  <td className="py-3 pl-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                    {r.tips_total > 0 ? money(r.tips_total) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
