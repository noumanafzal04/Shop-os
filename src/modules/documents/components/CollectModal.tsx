import { useState } from "react";

import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useOnceKey } from "../../../common/onceKey";
import { useMoney } from "../../shop/hooks/useShop";
import { useCounterShift } from "../../pos/hooks/useCounterShift";
import { ShiftNeeded } from "../../pos/components/ShiftNeeded";
import { DEPOSIT_METHODS } from "../services/documentService";

/**
 * How a bill can be settled. An ADVANCE can never be "on khata" — that list is
 * DEPOSIT_METHODS — but the final bill can: a laundry bills a hostel monthly,
 * a distributor a dealer. One list answered both questions and no job,
 * quotation or advance could ever go on an account (services #S3).
 */
const ON_KHATA = { value: "credit", label: "Khata" } as const;

/** Bill & hand over: the goods go out, the balance is taken. */
export function CollectModal({
  isOpen,
  onClose,
  balance,
  layaway,
  pending,
  odometerIn,
  asksOdometer,
  khata = false,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  balance: number;
  layaway: boolean;
  pending: boolean;
  /**
   * The reading taken when the vehicle came IN, or null when this document is
   * not a job card. Its presence is what makes the handover box appear.
   */
  odometerIn: number | null;
  asksOdometer: boolean;
  /**
   * May this bill go on the customer's account: the shop keeps a customer
   * book, this person may sell on khata, and the document names a customer.
   * The server holds every one of those again.
   */
  khata?: boolean;
  onSubmit: (p: {
    payment_method?: string;
    amount_paid?: number;
    odometer?: number;
    idempotency_key: string;
  }) => void;
}) {
  // The same key for every press of "Bill it" — a fresh one each press was a
  // second sale for a double-click.
  const once = useOnceKey();
  // Billing is a sale at the counter: today's shift, where the shop asks for one.
  const counterShift = useCounterShift();
  /**
   * What was taken — the balance until somebody types otherwise (B26). It was
   * only a grey placeholder, and "Bill it" stayed shut until the same figure
   * was typed over it: one more step at the counter, every time, for the
   * commonest answer there is.
   */
  const [typed, setTyped] = useState<string | null>(null);
  const [method, setMethod] = useState<string>("cash");
  /**
   * THE READING ON THE WAY OUT.
   *
   * A service interval is counted from the INVOICE, not from the job card, and
   * a car that sat on the ramp for a week with a road test in the middle
   * leaves on a different number than it arrived on. This box was never here,
   * so the arrival figure was billed every time and every car was called back
   * late.
   *
   * Pre-filled with the arrival reading: for the shop that takes one figure
   * and no more, billing stays a single press.
   */
  const [odometer, setOdometer] = useState("");
  const money = useMoney();

  const due = Math.max(0, balance);
  const onKhata = khata && method === ON_KHATA.value;
  const tendered = typed ?? (due > 0 ? String(Math.round(due * 100) / 100) : "");
  // On khata the whole balance goes on the account — nothing is handed over.
  const paid = onKhata ? due : Number(tendered) || 0;
  // Each opening starts from the balance again, not from what was typed last time.
  const close = () => { setTyped(null); onClose(); };
  const short = due > 0 && paid < due;

  const typedOdo = odometer.trim() === "" ? null : Number(odometer);
  const odoOut = typedOdo !== null && Number.isFinite(typedOdo) ? typedOdo : null;
  // An odometer only counts up. The server refuses this too; catching it here
  // means the shop is told before the customer has been charged.
  const odoBackwards = odoOut !== null && odometerIn !== null && odoOut < odometerIn;

  return (
    <Modal isOpen={isOpen} onClose={close} className="max-w-md">
      <ModalForm
        title="Bill &amp; hand over"
        footer={
          <>
            <Button size="sm" variant="outline" onClick={close}>Cancel</Button>
            <Button
              size="sm"
              disabled={pending || (due > 0 && paid < due) || odoBackwards || !counterShift.ready}
              onClick={() => {
                onSubmit({
                  ...(due > 0 ? { payment_method: method, amount_paid: paid } : {}),
                  ...(odoOut !== null ? { odometer: odoOut } : {}),
                  idempotency_key: once.key,
                });
                setTyped(null);
              }}
            >
              Bill it
            </Button>
          </>
        }
      >
        <div className="mb-3"><ShiftNeeded why={counterShift.why} /></div>
        <p className="mb-5 text-theme-sm text-gray-500 dark:text-gray-400">
          {due > 0
            ? `Take ${money(due)} and the goods go out.`
            : layaway
              ? "This booking is paid in full — nothing to collect."
              : "Nothing has been paid yet, so take the full amount."}
        </p>
        {(asksOdometer || odometerIn !== null) && (
          <div className="mb-4">
            <Label>Odometer on handover</Label>
            <Input
              type="number"
              min="0"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              placeholder={odometerIn !== null ? String(odometerIn) : "km"}
            />
            {odoBackwards && odometerIn !== null ? (
              <p className="mt-1 text-theme-sm text-error-600 dark:text-error-400">
                Below the {odometerIn.toLocaleString()} km taken when it came in — an odometer only counts up.
              </p>
            ) : odometerIn !== null ? (
              <p className="mt-1 text-theme-xs text-gray-400">
                Came in at {odometerIn.toLocaleString()} km. Leave it blank to bill on that reading.
              </p>
            ) : (
              <p className="mt-1 text-theme-xs text-gray-400">
                No reading was taken when it came in. Write it now and the next service is counted from it.
              </p>
            )}
          </div>
        )}
        {due > 0 && (
          <div className="space-y-4">
            {onKhata ? (
              <p data-bill-on-khata className="rounded-lg bg-gray-50 px-3 py-2 text-theme-sm text-gray-700 dark:bg-white/[0.03] dark:text-gray-300">
                {money(due)} goes on the customer's khata. Nothing is taken now.
              </p>
            ) : (
              <div>
                <Label>Amount taken</Label>
                <Input type="number" value={tendered} onChange={(e) => setTyped(e.target.value)} placeholder={String(due)} />
              </div>
            )}
            <div>
              <Label>Paid by</Label>
              <div className="flex flex-wrap gap-2">
                {[...DEPOSIT_METHODS, ...(khata ? [ON_KHATA] : [])].map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMethod(m.value)}
                    className={`rounded-lg border px-3.5 py-2 text-theme-sm font-medium transition ${
                      method === m.value
                        ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                        : "border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-400"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {short && paid > 0 && (
              <p className="text-theme-sm text-warning-600 dark:text-warning-400">
                {money(due - paid)} short of the balance.
              </p>
            )}
          </div>
        )}
      </ModalForm>
    </Modal>
  );
}
