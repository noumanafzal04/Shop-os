import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import TextArea from "../../../components/form/input/TextArea";
import Button from "../../../components/ui/button/Button";
import { Modal } from "../../../components/ui/modal";
import { purchasesService } from "../../purchases/services/purchasesService";
import type {
  BatchDisposalInput,
  DisposalReason,
  Disposition,
} from "../services/inventoryService";

/**
 * Where this lot is going.
 *
 * ── Why a dialogue and not a confirm() ──────────────────────────────────
 *
 * Removing a batch used to be `confirm("Remove this batch?")`, and the answer
 * was written to one movement whose reason covered three unrelated events: a
 * write-off, a return to the distributor, and a mis-keyed lot. Afterwards the
 * shop could not total what expiry had cost it, and could not tell anyone what
 * the distributor still owed.
 *
 * That mattered more here than almost anywhere else on the platform, because a
 * pharmacy's money does not mostly leak at the counter — it expires on the
 * shelf, and distributors take medicine back for credit inside a window that
 * closes months before the printed date. The claim is real money, and it was
 * being tracked on paper or not at all.
 *
 * ── The two answers are opposites ───────────────────────────────────────
 *
 * Binned is a loss. Sent back is a claim — not lost, not recovered, and only
 * recovered if somebody chases it. So they are two buttons, not two entries in
 * a dropdown of "reasons", and the form changes shape between them: a return
 * asks who it goes to, and a write-off has nobody to ask about.
 */

const REASONS: Array<{ key: DisposalReason; label: string }> = [
  { key: "expired", label: "Expired" },
  { key: "damaged", label: "Damaged" },
  { key: "recall", label: "Recalled" },
  { key: "other", label: "Other" },
];

interface Props {
  batch: { id: string; batch_number: string; quantity: number; expiry_date?: string | null };
  productName: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (disposal: BatchDisposalInput) => void;
}

export function DisposeBatchModal({ batch, productName, busy, onClose, onConfirm }: Props) {
  const [disposition, setDisposition] = useState<Disposition>("written_off");
  const [reason, setReason] = useState<DisposalReason>("expired");
  const [supplierId, setSupplierId] = useState("");
  const [credit, setCredit] = useState("");
  const [notes, setNotes] = useState("");

  const returning = disposition === "returned_to_supplier";

  // Only fetched when it can be needed — a shop binning stock has no reason to
  // pull a supplier list.
  const suppliers = useQuery({
    queryKey: ["suppliers", "for-disposal"],
    queryFn: async () => (await purchasesService.suppliers({ is_active: true })).data,
    enabled: returning,
    staleTime: 10 * 60 * 1000,
  });

  const ready = !returning || supplierId !== "";

  return (
    <Modal isOpen onClose={onClose} className="max-w-md p-6">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">Where is this going?</h3>
      <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
        {productName} · batch {batch.batch_number} · {batch.quantity} in stock
        {batch.expiry_date ? ` · expires ${batch.expiry_date}` : ""}
      </p>

      <div className="mt-5 space-y-4">
        {/* The two answers, side by side, because they are opposites rather
            than neighbours in a list. */}
        <div className="grid grid-cols-2 gap-2">
          {([
            ["written_off", "Written off", "Binned. A loss."],
            ["returned_to_supplier", "Sent back", "A claim to chase."],
          ] as const).map(([key, label, hint]) => (
            <button
              key={key}
              type="button"
              onClick={() => setDisposition(key)}
              className={`rounded-xl border-2 px-3 py-2.5 text-left transition ${
                disposition === key
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <span className="block text-theme-sm font-medium text-gray-800 dark:text-white/90">{label}</span>
              <span className="block text-[11px] text-gray-500 dark:text-gray-400">{hint}</span>
            </button>
          ))}
        </div>

        <div>
          <Label>Why</Label>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setReason(r.key)}
                className={`rounded-lg border px-3 py-1.5 text-theme-xs transition ${
                  reason === r.key
                    ? "border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {returning && (
          <>
            <div>
              <Label>Back to</Label>
              {/* A claim with nobody to claim from is not a claim. */}
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 focus:border-brand-300 focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              >
                <option value="">Choose the supplier…</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Credit expected (optional)</Label>
              <Input
                value={credit}
                placeholder="Leave blank if not agreed yet"
                onChange={(e) => setCredit(e.target.value.replace(/[^\d.]/g, ""))}
              />
              <p className="mt-1 text-theme-xs text-gray-400">
                You can send a box back before anyone has agreed what it is worth. Record what
                actually arrives later, from Disposals.
              </p>
            </div>
          </>
        )}

        <div>
          <Label>Notes (optional)</Label>
          <TextArea rows={2} value={notes} onChange={(v) => setNotes(v)} placeholder="Anything that explains this" />
        </div>
      </div>

      <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-theme-xs text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
        {batch.quantity} will go out of stock either way. What changes is whether it counts as a
        loss or as money somebody owes you.
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          disabled={!ready || busy}
          onClick={() =>
            onConfirm({
              disposition,
              reason,
              ...(notes.trim() ? { notes: notes.trim() } : {}),
              ...(returning ? { supplier_id: supplierId } : {}),
              ...(returning && credit.trim() !== "" ? { credit_expected: Number(credit) } : {}),
            })
          }
        >
          {busy ? "Removing…" : returning ? "Send back" : "Write off"}
        </Button>
      </div>
    </Modal>
  );
}
