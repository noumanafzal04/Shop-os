import { useState } from "react";

import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { Modal } from "../../../components/ui/modal";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useMoney } from "../../shop/hooks/useShop";
import { useCreditDisposal, useDisposals } from "../hooks/useInventory";
import type { StockDisposal } from "../services/inventoryService";
import { useBranchColumn } from "../../branches/hooks/useBranchColumn";
import { toIsoDate } from "../../../components/ui/filters";

/**
 * What left the shelf without being sold, and what is owed back for it.
 *
 * ── Two questions, deliberately not one total ───────────────────────────
 *
 * "What did expiry cost me?" is written-off stock. Money already gone.
 *
 * "What has this distributor still not credited?" is returned stock. Money
 * neither lost nor recovered — and only recovered if somebody chases it.
 *
 * Adding them would produce a loss figure overstated by everything the
 * distributor is about to pay back, and a shopkeeper would then price against
 * it. So the two live in separate tabs with separate totals, and no number on
 * this screen ever sums across them.
 *
 * ── Why the claims tab is first ─────────────────────────────────────────
 *
 * Because it is the one that can still change. The write-off list is history;
 * the claims list is a phone call.
 */

type Tab = "claims" | "written_off" | "all";

const TABS: Array<[Tab, string]> = [
  ["claims", "To claim"],
  ["written_off", "Written off"],
  ["all", "Everything"],
];

const REASON_LABELS: Record<string, string> = {
  expired: "Expired",
  damaged: "Damaged",
  recall: "Recalled",
  other: "Other",
};

export default function DisposalsPage() {
  const branchCol = useBranchColumn();
  const money = useMoney();
  const [tab, setTab] = useState<Tab>("claims");
  const [settling, setSettling] = useState<StockDisposal | null>(null);

  const filters =
    tab === "claims"
      ? { awaiting_credit: 1 as const }
      : tab === "written_off"
        ? { disposition: "written_off" as const }
        : {};

  const q = useDisposals(filters);
  const rows = q.data?.rows ?? [];

  // Totalled only within a tab. `total_cost` is null where the lot never
  // carried a cost — those rows are counted but not valued, and the strip says
  // so rather than quietly reading as zero.
  const valued = rows.filter((r) => r.total_cost !== null);
  const total = valued.reduce((sum, r) => sum + Number(r.total_cost), 0);
  const unvalued = rows.length - valued.length;

  return (
    <>
      <PageMeta title="Disposals | CartZe" description="Stock written off or sent back, and what is owed for it" />

      <div className="mb-5">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Disposals</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Stock that left without being sold — binned, or sent back for credit.
        </p>
      </div>

      <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-theme-sm font-medium transition ${
              tab === key
                ? "border-brand-500 text-brand-500"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="text-theme-xs uppercase tracking-wide text-gray-400">
            {tab === "claims" ? "Waiting on the supplier" : tab === "written_off" ? "Cost of what was binned" : "Value on this list"}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-800 dark:text-white/90">
            {money(total)}
          </p>
          <p className="mt-0.5 text-theme-xs text-gray-400">
            {rows.length} lot{rows.length === 1 ? "" : "s"}
            {/* Not folded into the figure. A lot with no recorded cost is
                unknown, and unknown is not zero. */}
            {unvalued > 0 && ` · ${unvalued} with no cost recorded, not counted above`}
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 font-medium">Why</th>
                {branchCol.show && <th className="px-4 py-2.5 font-medium">Branch</th>}
                <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                <th className="px-4 py-2.5 font-medium">Where it went</th>
                <th className="px-4 py-2.5 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <tr><td colSpan={branchCol.show ? 7 : 6} className="px-4 py-10 text-center text-sm text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={branchCol.show ? 7 : 6} className="px-4 py-12 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {tab === "claims" ? "Nothing waiting on a supplier." : "Nothing here."}
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-theme-xs text-gray-400">
                      When you remove a batch from Inventory you say whether it was binned or sent
                      back. Anything sent back shows here until the credit arrives.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((d) => (
                  <tr key={d.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/60">
                    <td className="px-4 py-3">
                      <div className="text-gray-800 dark:text-white/90">{d.product_name}</div>
                      <div className="text-theme-xs text-gray-400">
                        {d.number}
                        {d.batch_number ? ` · batch ${d.batch_number}` : ""}
                        {d.expiry_date ? ` · exp ${d.expiry_date}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                      {REASON_LABELS[d.reason] ?? d.reason}
                    </td>
                    {branchCol.show && (
                      <td className="px-4 py-3 text-theme-xs text-gray-600 dark:text-gray-300">{branchCol.label(d.branch_id)}</td>
                    )}
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-200">
                      {Number(d.quantity)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-200">
                      {/* Unknown, not zero. */}
                      {d.total_cost === null ? <span className="text-gray-300">—</span> : money(d.total_cost)}
                    </td>
                    <td className="px-4 py-3">
                      {d.disposition === "written_off" ? (
                        <span className="text-gray-500 dark:text-gray-400">Binned</span>
                      ) : (
                        <span className="text-gray-800 dark:text-white/90">
                          {d.supplier?.name ?? "A supplier"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {d.disposition === "written_off" ? (
                        <span className="text-gray-300">—</span>
                      ) : d.credit_received_at !== null ? (
                        <div>
                          <div className="tabular-nums font-medium text-success-600 dark:text-success-400">
                            {money(d.credit_received ?? 0)}
                          </div>
                          <div className="text-theme-xs text-gray-400">
                            {d.credit_received_at}
                            {d.credit_reference ? ` · ${d.credit_reference}` : ""}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          {d.credit_expected !== null && (
                            <span className="text-theme-xs text-gray-400">
                              {money(d.credit_expected)} expected
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setSettling(d)}
                            className="rounded-lg border border-brand-300 px-2 py-1 text-theme-xs text-brand-600 hover:bg-brand-50 dark:border-brand-500/40 dark:text-brand-400"
                          >
                            Credit received
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {settling && <CreditModal disposal={settling} onClose={() => setSettling(null)} />}
    </>
  );
}

/**
 * The distributor settled — for whatever they decided it was worth.
 *
 * The amount is typed rather than defaulted from what was claimed. A credit
 * note that comes back short is the normal case, and pre-filling the expected
 * figure would make agreeing with it the path of least resistance.
 */
function CreditModal({ disposal, onClose }: { disposal: StockDisposal; onClose: () => void }) {
  const toast = useToast();
  const credit = useCreditDisposal();

  const [amount, setAmount] = useState("");
  const [on, setOn] = useState(() => toIsoDate(new Date()));
  const [reference, setReference] = useState("");

  return (
    <Modal isOpen onClose={onClose} className="max-w-sm p-6">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Credit received</h3>
      <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
        {disposal.product_name} · {disposal.number}
        {disposal.credit_expected !== null && ` · Rs ${Number(disposal.credit_expected).toLocaleString()} was expected`}
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <Label>Amount actually credited</Label>
          <Input
            value={amount}
            placeholder="What the credit note says"
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
        </div>
        <div>
          <Label>Date on the credit note</Label>
          <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </div>
        <div>
          <Label>Credit note number (optional)</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="CN-4471" />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          disabled={amount.trim() === "" || credit.isPending}
          onClick={() =>
            credit.mutate(
              {
                id: disposal.id,
                credit_received: Number(amount),
                credit_received_at: on,
                ...(reference.trim() ? { credit_reference: reference.trim() } : {}),
              },
              {
                onSuccess: () => { toast.success("Credit recorded"); onClose(); },
                onError: (e) =>
                  toast.error(
                    e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "That could not be recorded.",
                  ),
              },
            )
          }
        >
          {credit.isPending ? "Saving…" : "Record it"}
        </Button>
      </div>
    </Modal>
  );
}
