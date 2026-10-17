import { useEffect, useState } from "react";
import { Modal } from "../../../components/ui/modal";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useMoney } from "../../shop/hooks/useShop";
import { useDocumentMutations, useDocumentWorth } from "../hooks/useDocuments";
import { DEPOSIT_METHODS, documentService } from "../services/documentService";
import type { SaleDocument } from "../services/documentService";
import { useOnceKey } from "../../../common/onceKey";
import { useCashNeedsShift } from "../../pos/hooks/useCounterShift";
import { ShiftNeeded } from "../../pos/components/ShiftNeeded";

/**
 * THE CUSTOMER CAME BACK WITH THE QUOTE AND PUT MONEY DOWN (B65).
 *
 * The advance used to be typed out again from nothing, at today's prices —
 * and the quote stayed open beside it. Now the quote's own lines are held, at
 * the price on the paper, and the quote closes by itself (the owner,
 * 2026-10-16). The total and the least it takes down are the server's.
 */
export function HoldQuoteModal({
  isOpen,
  onClose,
  quote,
  onHeld,
}: {
  isOpen: boolean;
  onClose: () => void;
  quote: SaleDocument;
  onHeld: (held: SaleDocument) => void;
}) {
  const toast = useToast();
  const money = useMoney();
  const { create } = useDocumentMutations();
  const once = useOnceKey();

  const [name, setName] = useState(quote.customer_name ?? "");
  const [phone, setPhone] = useState(quote.customer_phone ?? "");
  const [deposit, setDeposit] = useState("");
  const [method, setMethod] = useState("cash");

  useEffect(() => {
    if (!isOpen) return;
    setName(quote.customer_name ?? "");
    setPhone(quote.customer_phone ?? "");
    setDeposit("");
  }, [isOpen, quote.customer_name, quote.customer_phone]);

  const worth = useDocumentWorth({ kind: "layaway", from_document_id: quote.id }, isOpen);
  const priced = worth.data;
  const refused = worth.error instanceof ApiError ? worth.error.message : worth.isError ? "Couldn't work out what it comes to." : null;
  const minPct = priced?.min_deposit_percent ?? 0;
  const minimum = priced?.minimum_deposit ?? 0;
  const depositValue = Number(deposit) || 0;
  const belowMinimum = minimum > 0 && depositValue + 0.001 < minimum;
  const missingCustomer = !phone.trim();
  const shiftWhy = useCashNeedsShift(method, depositValue);

  const submit = () => {
    create.mutate(
      {
        kind: "layaway",
        from_document_id: quote.id,
        customer_name: name.trim() || undefined,
        customer_phone: phone.trim() || undefined,
        deposit: { amount: depositValue, method },
        idempotency_key: once.key,
      },
      {
        onSuccess: (res) => {
          once.renew();
          const held = res.data;
          toast.success(`Goods held · ${held.number}`);
          // The customer walks out with the advance slip — that IS the document.
          void documentService.print(held.id).catch(() => toast.error("Held, but the print dialog didn't open."));
          onClose();
          onHeld(held);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't hold the goods."),
      },
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md p-6">
      <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Hold on advance</h3>
      <p className="mb-5 text-theme-sm text-gray-500 dark:text-gray-400" data-testid="hold-worth">
        {priced ? money(priced.total) : "Working out the total…"} · the price on {quote.number}. The goods are set aside
        and the quotation closes.
      </p>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Customer</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
          </div>
        </div>
        {missingCustomer && (
          <p className="text-theme-sm text-warning-600 dark:text-warning-400">
            Goods held for nobody can't be collected or chased — add a phone number.
          </p>
        )}

        <div>
          <Label>Advance taken</Label>
          <Input
            type="number"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            placeholder={minimum > 0 ? String(minimum) : undefined}
          />
          {minPct > 0 && (
            <p data-testid="hold-floor" className={`mt-1 text-theme-xs ${belowMinimum ? "text-warning-600 dark:text-warning-400" : "text-gray-400"}`}>
              At least {minPct}% down — {money(minimum)}.
            </p>
          )}
        </div>
        <div>
          <Label>Paid by</Label>
          <div className="flex flex-wrap gap-2">
            {DEPOSIT_METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(m.value)}
                className={`rounded-lg border px-3 py-1.5 text-theme-sm font-medium transition ${
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
      </div>

      {shiftWhy && <div className="mt-4"><ShiftNeeded why={shiftWhy} /></div>}
      {refused && <p className="mt-4 text-theme-sm text-error-600 dark:text-error-400">{refused}</p>}

      <div className="mt-6 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          disabled={create.isPending || missingCustomer || !priced || worth.isFetching || belowMinimum || depositValue <= 0 || shiftWhy !== null}
          onClick={submit}
        >
          Hold the goods
        </Button>
      </div>
    </Modal>
  );
}
