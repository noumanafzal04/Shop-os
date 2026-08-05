import { useEffect, useState } from "react";
import { Modal } from "../../../components/ui/modal";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useShopSettings, useMoney } from "../../shop/hooks/useShop";
import { useDocumentMutations } from "../hooks/useDocuments";
import { DEPOSIT_METHODS, documentService } from "../services/documentService";
import type { DocumentKind, DocumentLineInput } from "../services/documentService";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  lines: DocumentLineInput[];
  discount: number;
  customerName: string;
  customerPhone: string;
  /** The till's own estimate — used only to size the deposit hint. */
  total: number;
  /** Clear the ticket once the promise is on paper. */
  onDone: () => void;
}

/**
 * "Estimate bana do" / "Advance rakh do", from the cart already on screen.
 *
 * The two are one form because the cashier is answering one question — how
 * committed is this customer — and the answer changes exactly one thing: money
 * down, which takes the goods off the shelf.
 */
export default function ParkAsDocumentModal({
  isOpen,
  onClose,
  lines,
  discount,
  customerName,
  customerPhone,
  total,
  onDone,
}: Props) {
  const toast = useToast();
  const money = useMoney();
  const settings = useShopSettings();
  const { create } = useDocumentMutations();

  const [kind, setKind] = useState<DocumentKind>("quotation");
  const [name, setName] = useState(customerName);
  const [phone, setPhone] = useState(customerPhone);
  const [expires, setExpires] = useState("");
  const [deposit, setDeposit] = useState("");
  const [method, setMethod] = useState("cash");

  const layawayOn = settings.data?.layaway_enabled !== false;
  const quotesOn = settings.data?.quotations_enabled !== false;
  const minPct = Number(settings.data?.layaway_min_deposit_percent ?? 20);
  const minimum = Math.ceil((total * minPct) / 100);

  // Re-seed from the till each time it opens — the cashier may have typed the
  // customer's name into the cart after the last time this was used.
  useEffect(() => {
    if (!isOpen) return;
    setName(customerName);
    setPhone(customerPhone);
    setKind(quotesOn ? "quotation" : "layaway");
    setExpires("");
    setDeposit("");
  }, [isOpen, customerName, customerPhone, quotesOn]);

  const layaway = kind === "layaway";
  const depositValue = Number(deposit) || 0;
  const belowMinimum = layaway && minPct > 0 && depositValue < minimum;
  const missingCustomer = layaway && !phone.trim();

  const submit = () => {
    create.mutate(
      {
        kind,
        items: lines,
        discount: discount || undefined,
        customer_name: name.trim() || undefined,
        customer_phone: phone.trim() || undefined,
        expires_at: expires || undefined,
        deposit: layaway ? { amount: depositValue, method } : undefined,
        idempotency_key: crypto.randomUUID(),
      },
      {
        onSuccess: (res) => {
          const doc = res.data;
          toast.success(
            layaway ? `Goods held · ${doc.number}` : `Quotation ${doc.number} saved`,
          );
          // The customer walks out with the paper — that IS the document.
          void documentService.print(doc.id).catch(() => {
            toast.error("Saved, but the print dialog didn't open.");
          });
          onDone();
          onClose();
        },
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.message : "Couldn't save it."),
      },
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md p-6">
      <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
        Save this ticket
      </h3>
      <p className="mb-5 text-theme-sm text-gray-500 dark:text-gray-400">
        {money(total)} · {lines.length} line{lines.length === 1 ? "" : "s"}
      </p>

      <div className="mb-5 grid grid-cols-2 gap-2">
        <KindCard
          active={!layaway}
          disabled={!quotesOn}
          onClick={() => setKind("quotation")}
          title="Quotation"
          blurb="A written price, held until a date. Nothing moves."
        />
        <KindCard
          active={layaway}
          disabled={!layawayOn}
          onClick={() => setKind("layaway")}
          title="On advance"
          blurb="Money down, goods set aside until the balance is paid."
        />
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Customer</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          </div>
          <div>
            <Label>Phone{layaway ? "" : " (optional)"}</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
          </div>
        </div>

        {missingCustomer && (
          <p className="text-theme-sm text-warning-600 dark:text-warning-400">
            Goods held for nobody can't be collected or chased — add a phone number.
          </p>
        )}

        <div>
          <Label>{layaway ? "Collect by" : "Valid until"}</Label>
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          <p className="mt-1 text-theme-xs text-gray-400">
            Leave blank to use the shop's usual window.
          </p>
        </div>

        {layaway && (
          <>
            <div>
              <Label>Advance taken</Label>
              <Input
                type="number"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                placeholder={String(minimum)}
              />
              {minPct > 0 && (
                <p className={`mt-1 text-theme-xs ${belowMinimum ? "text-warning-600 dark:text-warning-400" : "text-gray-400"}`}>
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
          </>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          disabled={create.isPending || lines.length === 0 || missingCustomer || belowMinimum}
          onClick={submit}
        >
          {layaway ? "Hold the goods" : "Save quotation"}
        </Button>
      </div>
    </Modal>
  );
}

function KindCard({
  active,
  disabled,
  onClick,
  title,
  blurb,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
          : "border-gray-200 hover:border-gray-300 dark:border-gray-700"
      }`}
    >
      <div className={`font-medium ${active ? "text-brand-600 dark:text-brand-400" : "text-gray-800 dark:text-white/90"}`}>
        {title}
      </div>
      <div className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">{blurb}</div>
    </button>
  );
}
