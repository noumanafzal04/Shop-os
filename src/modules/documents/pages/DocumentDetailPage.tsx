import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Badge from "../../../components/ui/badge/Badge";
import Alert from "../../../components/ui/alert/Alert";
import { Modal, ModalForm } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useMoney, useShopSettings } from "../../shop/hooks/useShop";
import { receiptService } from "../../receipts/services/receiptService";
import { useDocument, useDocumentMutations } from "../hooks/useDocuments";
import { DEPOSIT_METHODS, documentService } from "../services/documentService";
import { uuid } from "../../../common/uuid";
import { formatQuantity } from "../../../common/format/quantity";


/**
 * One promise, in full: what was quoted or held, what has been paid against it,
 * and the three things that can happen next — another instalment, the goods
 * going out, or the deal falling through.
 */
export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const money = useMoney();
  const toast = useToast();
  const settings = useShopSettings();

  const query = useDocument(id);
  const doc = query.data;
  const mut = useDocumentMutations(id);

  const depositModal = useModal();
  const collectModal = useModal();
  const cancelModal = useModal();

  if (query.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  }
  if (!doc) {
    return <p className="py-16 text-center text-gray-500">That document no longer exists.</p>;
  }

  const layaway = doc.kind === "layaway";
  const balance = doc.balance ?? Number(doc.total) - Number(doc.deposit_paid);
  const open = doc.status === "open";

  const print = () => {
    documentService.print(doc.id).catch(() => toast.error("Couldn't open the print dialog."));
  };

  return (
    <>
      <PageMeta title={`${doc.number} | CartZe`} description="Quotation / advance booking" />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/tenant/documents" className="text-theme-xs text-gray-500 hover:text-brand-500">
            ← Quotations &amp; advances
          </Link>
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold text-gray-800 dark:text-white/90">
            {doc.number}
            <Badge size="sm" color={layaway ? "primary" : "light"}>
              {layaway ? "On advance" : "Quotation"}
            </Badge>
            {doc.status === "converted" && <Badge size="sm" color="success">Collected</Badge>}
            {doc.status === "cancelled" && <Badge size="sm" color="light">Cancelled</Badge>}
            {doc.has_lapsed && <Badge size="sm" color="warning">{layaway ? "Overdue" : "Expired"}</Badge>}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {doc.customer_name ?? "Walk-in"}
            {doc.customer_phone && (
              <>
                {" · "}
                <a href={`tel:${doc.customer_phone}`} className="text-brand-500 hover:text-brand-600">
                  {doc.customer_phone}
                </a>
              </>
            )}
            {doc.expires_at && (
              <> · {layaway ? "Collect by" : "Valid until"} {new Date(doc.expires_at).toLocaleDateString()}</>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={print}>Print</Button>
          {open && layaway && (
            <Button size="sm" variant="outline" onClick={depositModal.openModal}>Take instalment</Button>
          )}
          {open && <Button size="sm" onClick={collectModal.openModal}>Bill &amp; hand over</Button>}
          {open && (
            <Button size="sm" variant="outline" onClick={cancelModal.openModal}>Cancel</Button>
          )}
        </div>
      </div>

      {/* A quotation that ran out can't be billed at the old price — say so
          here rather than letting the cashier discover it mid-transaction. */}
      {doc.has_lapsed && !layaway && open && (
        <div className="mb-5">
          <Alert
            variant="warning"
            title="This quotation has expired"
            message="The price is no longer held. Write a fresh quote at today's prices, or ring the sale directly."
          />
        </div>
      )}

      {doc.status === "converted" && doc.sale && (
        <div className="mb-5">
          <Alert
            variant="success"
            title={`Billed as ${doc.sale.invoice_number}`}
            message="The goods have been handed over and the sale is on the books."
          />
        </div>
      )}

      {doc.status === "cancelled" && (
        <div className="mb-5">
          <Alert
            variant="info"
            title="Cancelled"
            message={
              Number(doc.forfeited_amount) > 0
                ? `${money(doc.refunded_amount)} returned, ${money(doc.forfeited_amount)} kept as a cancellation fee.`
                : Number(doc.refunded_amount) > 0
                  ? `${money(doc.refunded_amount)} returned to the customer.`
                  : (doc.cancel_reason ?? "Nothing was paid on this document.")
            }
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── The items ────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-theme-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                  <th className="px-5 py-2.5 font-medium">Item</th>
                  <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                  <th className="px-3 py-2.5 text-right font-medium">Rate</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(doc.items ?? []).map((item) => (
                  <tr key={item.id} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                    <td className="px-5 py-3">
                      <span className="text-gray-800 dark:text-white/90">{item.product_name}</span>
                      {item.variant_name && <span className="text-gray-500"> · {item.variant_name}</span>}
                      {item.unit_name && <span className="text-gray-500"> ({item.unit_name})</span>}
                      {Number(item.line_discount) > 0 && (
                        <div className="text-theme-xs text-gray-400">less {money(item.line_discount)}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {formatQuantity(item.quantity)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {money(item.unit_price)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-800 dark:text-white/90">
                      {money(item.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(doc.terms || doc.notes) && (
            <div className="border-t border-gray-100 px-5 py-4 dark:border-gray-800">
              {doc.terms && (
                <>
                  <div className="text-theme-xs uppercase tracking-wide text-gray-400">Terms</div>
                  <p className="whitespace-pre-line text-theme-sm text-gray-600 dark:text-gray-400">{doc.terms}</p>
                </>
              )}
              {doc.notes && (
                <p className="mt-2 whitespace-pre-line text-theme-sm text-gray-500 dark:text-gray-400">{doc.notes}</p>
              )}
            </div>
          )}
        </section>

        {/* ── The money ────────────────────────────────────────────── */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
            <Row label="Subtotal" value={money(doc.subtotal)} />
            {Number(doc.discount) > 0 && <Row label="Discount" value={`− ${money(doc.discount)}`} />}
            {Number(doc.tax) > 0 && (
              <Row label={doc.tax_inclusive ? "Tax (included)" : "Tax"} value={money(doc.tax)} />
            )}
            <div className="my-3 border-t border-gray-200 dark:border-gray-700" />
            <Row label="Total" value={money(doc.total)} strong />

            {layaway && (
              <>
                <Row label="Advance paid" value={`− ${money(doc.deposit_paid)}`} />
                <div className="my-3 border-t border-gray-200 dark:border-gray-700" />
                <Row label="Balance due" value={money(balance)} strong accent />
              </>
            )}
          </div>

          {layaway && (doc.payments?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
              <div className="mb-3 text-theme-xs uppercase tracking-wide text-gray-400">Payments received</div>
              <ul className="space-y-2">
                {(doc.payments ?? []).map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3 text-theme-sm">
                    <span className="text-gray-600 dark:text-gray-400">
                      {new Date(p.paid_at).toLocaleDateString()}
                      <span className="text-gray-400"> · {methodLabel(p.method)}</span>
                    </span>
                    <span className="tabular-nums text-gray-800 dark:text-white/90">{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {/* ── Take an instalment ───────────────────────────────────── */}
      <DepositModal
        isOpen={depositModal.isOpen}
        onClose={depositModal.closeModal}
        balance={balance}
        pending={mut.deposit.isPending}
        onSubmit={(payload) =>
          mut.deposit.mutate(payload, {
            onSuccess: () => {
              toast.success("Advance recorded");
              depositModal.closeModal();
            },
            onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't record it."),
          })
        }
      />

      {/* ── Bill and hand over ───────────────────────────────────── */}
      <CollectModal
        isOpen={collectModal.isOpen}
        onClose={collectModal.closeModal}
        balance={balance}
        layaway={layaway}
        pending={mut.convert.isPending}
        onSubmit={(payload) =>
          mut.convert.mutate(payload, {
            onSuccess: (res) => {
              collectModal.closeModal();
              toast.success(`Billed as ${res.data.sale.invoice_number}`);
              // Print the real receipt straight away — the customer is standing
              // there and the sale, not the booking, is what they take home.
              void receiptService.printReceipt(res.data.sale.id);
            },
            onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't bill it."),
          })
        }
      />

      {/* ── Cancel ───────────────────────────────────────────────── */}
      <CancelModal
        isOpen={cancelModal.isOpen}
        onClose={cancelModal.closeModal}
        paid={Number(doc.deposit_paid)}
        money={money}
        // The shop's usual fee, as a starting figure only. It is never applied
        // for you — see the note in CancelModal.
        feePercent={Number(settings.data?.layaway_cancellation_fee_percent ?? 0)}
        pending={mut.cancel.isPending}
        onSubmit={(payload) =>
          mut.cancel.mutate(payload, {
            onSuccess: () => {
              cancelModal.closeModal();
              toast.success(`${doc.number} cancelled`);
              navigate("/tenant/documents");
            },
            onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't cancel it."),
          })
        }
      />
    </>
  );
}

// ── Modals ──────────────────────────────────────────────────────────

function DepositModal({
  isOpen,
  onClose,
  balance,
  pending,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  balance: number;
  pending: boolean;
  onSubmit: (p: { amount: number; method: string; reference?: string }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState("");
  const money = useMoney();

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md">
      <ModalForm
        title="Take an instalment"
        footer={
          <>
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={pending || !(Number(amount) > 0)}
              onClick={() => onSubmit({ amount: Number(amount), method, reference: reference || undefined })}
            >
              Record
            </Button>
          </>
        }
      >
        <p className="mb-5 text-theme-sm text-gray-500 dark:text-gray-400">
          {money(balance)} still owed. You can't take more than that.
        </p>
        <div className="space-y-4">
          <div>
            <Label>Amount</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(balance)}
            />
          </div>
          <div>
            <Label>Paid by</Label>
            <div className="flex flex-wrap gap-2">
              {DEPOSIT_METHODS.map((m) => (
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
          {method !== "cash" && (
            <div>
              <Label>Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Slip / txn no." />
            </div>
          )}
        </div>
      </ModalForm>
    </Modal>
  );
}

function CollectModal({
  isOpen,
  onClose,
  balance,
  layaway,
  pending,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  balance: number;
  layaway: boolean;
  pending: boolean;
  onSubmit: (p: { payment_method?: string; amount_paid?: number; idempotency_key: string }) => void;
}) {
  const [tendered, setTendered] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const money = useMoney();

  const due = Math.max(0, balance);
  const paid = Number(tendered) || 0;
  const short = due > 0 && paid < due;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md">
      <ModalForm
        title="Bill &amp; hand over"
        footer={
          <>
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={pending || (due > 0 && paid < due)}
              onClick={() =>
                onSubmit(
                  due > 0
                    ? { payment_method: method, amount_paid: paid, idempotency_key: uuid() }
                    : { idempotency_key: uuid() },
                )
              }
            >
              Bill it
            </Button>
          </>
        }
      >
        <p className="mb-5 text-theme-sm text-gray-500 dark:text-gray-400">
          {due > 0
            ? `Take ${money(due)} and the goods go out.`
            : layaway
              ? "This booking is paid in full — nothing to collect."
              : "Nothing has been paid yet, so take the full amount."}
        </p>
        {due > 0 && (
          <div className="space-y-4">
            <div>
              <Label>Amount taken</Label>
              <Input type="number" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={String(due)} />
            </div>
            <div>
              <Label>Paid by</Label>
              <div className="flex flex-wrap gap-2">
                {DEPOSIT_METHODS.map((m) => (
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

function CancelModal({
  isOpen,
  onClose,
  paid,
  money,
  feePercent,
  pending,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  paid: number;
  money: (n: string | number) => string;
  /** The shop's usual cancellation fee. A suggestion, never an application. */
  feePercent: number;
  pending: boolean;
  onSubmit: (p: { reason?: string; forfeit_amount?: number; refund_method?: string }) => void;
}) {
  const [reason, setReason] = useState("");
  const [forfeit, setForfeit] = useState("");

  /**
   * The shop's usual fee, filled in for whoever is cancelling.
   *
   * It is a STARTING FIGURE, not a rule. The server still defaults to handing
   * every rupee back when no split is stated — keeping a customer's money by
   * accident is the worse mistake, so nothing is ever deducted without someone
   * choosing it. All this saves is the arithmetic.
   */
  const suggested = feePercent > 0 ? Math.round(paid * feePercent) / 100 : 0;

  // Re-seed each time the dialog opens: a fee typed for the last cancellation
  // must not carry over onto a different customer's money.
  useEffect(() => {
    if (isOpen) setForfeit(suggested > 0 ? String(suggested) : "");
  }, [isOpen, suggested]);

  const kept = Math.min(Math.max(0, Number(forfeit) || 0), paid);
  const back = Math.max(0, paid - kept);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md">
      <ModalForm
        title="Cancel this document"
        footer={
          <>
            <Button size="sm" variant="outline" onClick={onClose}>Keep it open</Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                onSubmit({
                  reason: reason || undefined,
                  forfeit_amount: paid > 0 ? kept : undefined,
                  refund_method: paid > 0 ? "cash" : undefined,
                })
              }
            >
              Cancel document
            </Button>
          </>
        }
      >
        <p className="mb-5 text-theme-sm text-gray-500 dark:text-gray-400">
          {paid > 0
            ? "The goods go back on the shelf, and the advance is accounted for below."
            : "Nothing was paid and nothing is being held — this just closes it."}
        </p>
        <div className="space-y-4">
          <div>
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer changed their mind" />
          </div>
          {paid > 0 && (
            <>
              <div>
                <Label>Cancellation fee kept</Label>
                <Input type="number" value={forfeit} onChange={(e) => setForfeit(e.target.value)} placeholder="0" />
                {suggested > 0 && (
                  <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
                    Your usual fee is {feePercent}% — {money(suggested)} on this booking. Change it or clear it to
                    return everything.
                  </p>
                )}
              </div>
              {/* Say plainly what the customer walks away with — this is the
                  number they will remember, and getting it wrong is the kind of
                  mistake that ends up in an argument at the counter. */}
              <div className="rounded-xl bg-gray-50 px-4 py-3 text-theme-sm dark:bg-white/5">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Returned to customer</span>
                  <span className="font-semibold tabular-nums text-gray-800 dark:text-white/90">{money(back)}</span>
                </div>
                {kept > 0 && (
                  <div className="mt-1 flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Kept by the shop</span>
                    <span className="tabular-nums text-gray-600 dark:text-gray-400">{money(kept)}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </ModalForm>
    </Modal>
  );
}

// ── Small pieces ────────────────────────────────────────────────────

function Row({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className={strong ? "font-medium text-gray-700 dark:text-gray-200" : "text-theme-sm text-gray-500 dark:text-gray-400"}>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          accent
            ? "text-lg font-bold text-brand-500"
            : strong
              ? "text-lg font-semibold text-gray-800 dark:text-white/90"
              : "text-theme-sm text-gray-700 dark:text-gray-300"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

const methodLabel = (m: string) => DEPOSIT_METHODS.find((x) => x.value === m)?.label ?? m;

/** 2.000 reads wrong next to a quantity; 2 does. Real fractions survive. */

