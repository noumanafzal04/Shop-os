import { useEffect, useState } from "react";
import { useOnceKey } from "../../../common/onceKey";
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
import { formatQuantity } from "../../../common/format/quantity";
import { usePrimaryBusinessType } from "../../../common/tenant/businessType";
import { boardWords } from "../../workshop/words";
import { AddToJob } from "../components/AddToJob";
import { shopDate, shopShortDateTime } from "../../../common/format/date";
import { useCashNeedsShift } from "../../pos/hooks/useCounterShift";
import { ShiftNeeded } from "../../pos/components/ShiftNeeded";
import { PrintPaperModal } from "../components/PrintPaperModal";
import { HoldQuoteModal } from "../components/HoldQuoteModal";
import { CollectModal } from "../components/CollectModal";


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
  const depositOnce = useOnceKey();
  const words = boardWords(usePrimaryBusinessType());

  const depositModal = useModal();
  const collectModal = useModal();
  const cancelModal = useModal();
  const paperModal = useModal();
  const holdModal = useModal();

  if (query.isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  }
  if (!doc) {
    return <p className="py-16 text-center text-gray-500">That document no longer exists.</p>;
  }

  const layaway = doc.kind === "layaway";
  /**
   * A JOB CARD IS NOT A QUOTATION.
   *
   * This page was written for the two kinds that came first, and a job card
   * opened on it as "Quotation", under "← Quotations & advances", with nothing
   * about the car — and its lines could not be added to, because nothing
   * could add to them. A job is unfinished by design: it says what it is,
   * which car, what the customer said, and takes parts and labour as the work
   * is done.
   */
  const job = doc.kind === "job_card";
  const balance = doc.balance ?? Number(doc.total) - Number(doc.deposit_paid);
  const open = doc.status === "open";
  const growing = job && open;
  /**
   * AN ADVANCE ON A JOB.
   *
   * The server has always taken one — parts are ordered before the work
   * starts, and a tailor takes money with the cloth — and the Help says so.
   * This page offered "Take instalment" for a layaway only, and drew the
   * advance and the balance for a layaway only: on a job there was no button,
   * and an advance taken any other way was invisible on the job it was for.
   */
  const takesAdvance = layaway || job;
  /**
   * The customer came back with the quote and puts money down (B65): its
   * goods are held at the price on the paper, and it closes by itself. Not a
   * lapsed one — its price has run out, the same as billing it.
   */
  const holdable = open && !layaway && !job && !doc.has_lapsed && settings.data?.layaway_enabled !== false;
  const heldAs = doc.status === "converted" ? doc.held_as ?? null : null;
  const holdsMoney = layaway || (job && Number(doc.deposit_paid) > 0);
  const linesBusy = mut.addItem.isPending || mut.setItemQuantity.isPending || mut.removeItem.isPending;
  const lineFailed = (e: unknown) => toast.error(e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "That could not be changed.");

  const print = (paper: string) => {
    paperModal.closeModal();
    documentService.print(doc.id, paper).catch(() => toast.error("Couldn't open the print dialog."));
  };

  return (
    <>
      <PageMeta title={`${doc.number}`} description={job ? "A job in the shop" : "Quotation / advance booking"} />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to={job ? "/tenant/workshop" : "/tenant/documents"} className="text-theme-xs text-gray-500 hover:text-brand-500">
            ← {job ? words.board : "Quotations & advances"}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold text-gray-800 dark:text-white/90">
            {doc.number}
            <Badge size="sm" color={layaway || job ? "primary" : "light"}>
              {job ? "Job card" : layaway ? "On advance" : "Quotation"}
            </Badge>
            {doc.status === "converted" && (heldAs
              ? <Badge size="sm" color="primary">Held on advance</Badge>
              : <Badge size="sm" color="success">Collected</Badge>)}
            {doc.status === "cancelled" && <Badge size="sm" color="light">Cancelled</Badge>}
            {doc.has_lapsed && <Badge size="sm" color="warning">{layaway || job ? "Overdue" : "Expired"}</Badge>}
          </h1>
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
              <> · {layaway || job ? "Collect by" : "Valid until"} {shopDate(doc.expires_at)}</>
            )}
            {/* Linked both ways (B65): the advance names the quote it was held from. */}
            {doc.source && (
              <>
                {" · from "}
                <Link data-testid="held-from" to={`/tenant/documents/${doc.source.id}`} className="text-brand-500 hover:text-brand-600">
                  {doc.source.number}
                </Link>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={paperModal.openModal}>Print</Button>
          {open && takesAdvance && (
            <Button size="sm" variant="outline" onClick={depositModal.openModal}>{job ? "Take an advance" : "Take instalment"}</Button>
          )}
          {holdable && (
            <Button size="sm" variant="outline" onClick={holdModal.openModal}>Hold on advance</Button>
          )}
          {open && <Button size="sm" onClick={collectModal.openModal}>Bill &amp; hand over</Button>}
          {open && (
            <Button size="sm" variant="outline" onClick={cancelModal.openModal}>Cancel</Button>
          )}
        </div>
      </div>

      {/* What the job IS: the car, what the customer said, when it is due, where it is. */}
      {job && (
        <div data-testid="job-details" className="mb-5 grid gap-4 rounded-2xl border border-gray-200 bg-white p-5 text-theme-sm shadow-theme-xs sm:grid-cols-2 lg:grid-cols-4 dark:border-gray-800 dark:bg-white/[0.03]">
          {words.tracksVehicle && (
            <JobFact label="Car">
              {doc.vehicle ? (
                <>
                  <span className="font-semibold">{doc.vehicle.registration}</span>
                  {[doc.vehicle.make, doc.vehicle.model].filter(Boolean).length > 0 && (
                    <span className="text-gray-500"> · {[doc.vehicle.make, doc.vehicle.model].filter(Boolean).join(" ")}</span>
                  )}
                </>
              ) : "—"}
            </JobFact>
          )}
          <JobFact label={words.said}>{doc.complaint || "—"}</JobFact>
          {words.tracksVehicle && (
            <JobFact label="Odometer coming in">
              {doc.odometer_in != null ? `${doc.odometer_in.toLocaleString()} km` : "—"}
            </JobFact>
          )}
          <JobFact label="Promised back">
            {doc.promised_at
              ? shopShortDateTime(doc.promised_at)
              : "—"}
          </JobFact>
          {open && doc.work_status && (
            <JobFact label="Where it is">
              {words.stages[["received", "in_progress", "ready"].indexOf(doc.work_status)] ?? doc.work_status}
            </JobFact>
          )}
        </div>
      )}

      {/* A quotation that ran out can't be billed at the old price — say so
          here rather than letting the cashier discover it mid-transaction. */}
      {doc.has_lapsed && !layaway && !job && open && (
        <div className="mb-5">
          <Alert
            variant="warning"
            title="This quotation has expired"
            message="The price is no longer held. Write a fresh quote at today's prices, or ring the sale directly."
          />
        </div>
      )}

      {heldAs && (
        <div className="mb-5" data-testid="held-as">
          <Alert
            variant="success"
            title={`Held on advance as ${heldAs.number}`}
            message="The customer put money down on this quotation. The goods are set aside at the price quoted here."
            showLink
            linkHref={`/tenant/documents/${heldAs.id}`}
            linkText={`Open ${heldAs.number}`}
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
                  {growing && <th className="w-10 px-2 py-2.5"><span className="sr-only">Remove</span></th>}
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
                      {growing ? (
                        // While the work is being done, a quantity can change.
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`One fewer ${item.product_name}`}
                            disabled={linesBusy || Number(item.quantity) <= 1}
                            onClick={() => mut.setItemQuantity.mutate({ itemId: item.id, quantity: Number(item.quantity) - 1 }, { onError: lineFailed })}
                            className="h-7 w-7 rounded-md border border-gray-300 text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
                          >−</button>
                          <LineQuantity
                            name={item.product_name}
                            quantity={Number(item.quantity)}
                            disabled={linesBusy}
                            onChange={(quantity, undo) => mut.setItemQuantity.mutate(
                              { itemId: item.id, quantity },
                              { onError: (e) => { undo(); lineFailed(e); } },
                            )}
                          />
                          <button
                            type="button"
                            aria-label={`One more ${item.product_name}`}
                            disabled={linesBusy}
                            onClick={() => mut.setItemQuantity.mutate({ itemId: item.id, quantity: Number(item.quantity) + 1 }, { onError: lineFailed })}
                            className="h-7 w-7 rounded-md border border-gray-300 text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
                          >+</button>
                        </span>
                      ) : formatQuantity(item.quantity)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-gray-600 dark:text-gray-400">
                      {money(item.unit_price)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-800 dark:text-white/90">
                      {money(item.line_total)}
                    </td>
                    {growing && (
                      <td className="px-2 py-3 text-right">
                        <button
                          type="button"
                          aria-label={`Take ${item.product_name} off the job`}
                          // The last line stays: a job with nothing on it is a job to cancel.
                          title={(doc.items ?? []).length <= 1 ? "A job has to have something on it — cancel the job instead" : undefined}
                          disabled={linesBusy || (doc.items ?? []).length <= 1}
                          onClick={() => mut.removeItem.mutate(item.id, { onError: lineFailed })}
                          className="rounded-md px-1.5 text-gray-400 hover:text-error-500 disabled:opacity-30"
                        >✕</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {growing && (
            <AddToJob
              label={words.addLine}
              disabled={linesBusy}
              onAdd={(pick) => mut.addItem.mutate(
                { product_id: pick.product_id, variant_id: pick.variant_id, quantity: 1 },
                { onSuccess: () => toast.success(`${pick.name} added to the job`), onError: lineFailed },
              )}
            />
          )}

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

            {holdsMoney && (
              <>
                <Row label="Advance paid" value={`− ${money(doc.deposit_paid)}`} />
                {doc.handover && <Row label="Paid at handover" value={`− ${money(doc.handover.amount)}`} />}
                <div className="my-3 border-t border-gray-200 dark:border-gray-700" />
                <Row label="Balance due" value={money(balance)} strong accent />
              </>
            )}
          </div>

          {holdsMoney && ((doc.payments?.length ?? 0) > 0 || doc.handover) && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
              <div className="mb-3 text-theme-xs uppercase tracking-wide text-gray-400">Payments received</div>
              <ul className="space-y-2">
                {(doc.payments ?? []).map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3 text-theme-sm">
                    <span className="text-gray-600 dark:text-gray-400">
                      {shopDate(p.paid_at)}
                      <span className="text-gray-400"> · {methodLabel(p.method)}</span>
                    </span>
                    <span className="tabular-nums text-gray-800 dark:text-white/90">{money(p.amount)}</span>
                  </li>
                ))}
                {doc.handover && (
                  <li data-handover className="flex items-baseline justify-between gap-3 text-theme-sm">
                    <span className="text-gray-600 dark:text-gray-400">
                      {doc.handover.paid_at ? shopDate(doc.handover.paid_at) : "At handover"}
                      <span className="text-gray-400">
                        {" "}· {doc.handover.methods.map(methodLabel).join(" + ") || "Paid"} · at handover, {doc.handover.invoice_number}
                      </span>
                    </span>
                    <span className="tabular-nums text-gray-800 dark:text-white/90">{money(doc.handover.amount)}</span>
                  </li>
                )}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {/* ── Take an instalment ───────────────────────────────────── */}
      <DepositModal
        title={job ? "Take an advance" : "Take an instalment"}
        isOpen={depositModal.isOpen}
        onClose={depositModal.closeModal}
        balance={balance}
        pending={mut.deposit.isPending}
        onSubmit={(payload) =>
          mut.deposit.mutate({ ...payload, idempotency_key: depositOnce.key }, {
            onSuccess: () => {
              depositOnce.renew();
              toast.success("Advance recorded");
              depositModal.closeModal();
            },
            onError: (e) => toast.error(e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "Couldn't record it."),
          })
        }
      />

      {holdable && (
        <HoldQuoteModal
          isOpen={holdModal.isOpen}
          onClose={holdModal.closeModal}
          quote={doc}
          onHeld={(held) => navigate(`/tenant/documents/${held.id}`)}
        />
      )}

      <PrintPaperModal
        isOpen={paperModal.isOpen}
        onClose={paperModal.closeModal}
        shopPaper={settings.data?.document_paper ?? "standard"}
        onPrint={print}
      />

      {/* ── Bill and hand over ───────────────────────────────────── */}
      <CollectModal
        isOpen={collectModal.isOpen}
        onClose={collectModal.closeModal}
        balance={balance}
        // "Paid in full" is true of a job settled by its advance, too.
        layaway={layaway || job}
        pending={mut.convert.isPending}
        odometerIn={doc.odometer_in ?? null}
        // Asked for any job that has a car — not only one whose reading was
        // taken at arrival. Skipped with the keys in hand, it could never be
        // written down for that visit at all.
        asksOdometer={job && !!doc.vehicle_id}
        onSubmit={(payload) =>
          mut.convert.mutate(payload, {
            onSuccess: (res) => {
              collectModal.closeModal();
              toast.success(`Billed as ${res.data.sale.invoice_number}`);
              // Print the real receipt straight away — the customer is standing
              // there and the sale, not the booking, is what they take home.
              void receiptService.printReceipt(res.data.sale.id);
            },
            onError: (e) => toast.error(e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "Couldn't bill it."),
          })
        }
      />

      {/* ── Cancel ───────────────────────────────────────────────── */}
      <CancelModal
        isOpen={cancelModal.isOpen}
        onClose={cancelModal.closeModal}
        paid={Number(doc.deposit_paid)}
        money={money}
        job={job}
        // The shop's usual fee, as a starting figure only. It is never applied
        // for you — see the note in CancelModal. It is the fee for goods HELD;
        // a job took nothing off the shelf, so it is not offered there.
        feePercent={job ? 0 : Number(settings.data?.layaway_cancellation_fee_percent ?? 0)}
        pending={mut.cancel.isPending}
        onSubmit={(payload) =>
          mut.cancel.mutate(payload, {
            onSuccess: () => {
              cancelModal.closeModal();
              toast.success(`${doc.number} cancelled`);
              navigate("/tenant/documents");
            },
            onError: (e) => toast.error(e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "Couldn't cancel it."),
          })
        }
      />
    </>
  );
}

// ── Modals ──────────────────────────────────────────────────────────

function DepositModal({
  title,
  isOpen,
  onClose,
  balance,
  pending,
  onSubmit,
}: {
  title: string;
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
  const shiftWhy = useCashNeedsShift(method, Number(amount) || 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md">
      <ModalForm
        title={title}
        footer={
          <>
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={pending || !(Number(amount) > 0) || shiftWhy !== null}
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
          <ShiftNeeded why={shiftWhy} />
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

function CancelModal({
  isOpen,
  onClose,
  paid,
  money,
  job,
  feePercent,
  pending,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  paid: number;
  money: (n: string | number) => string;
  /** A job holds no goods, so nothing "goes back on the shelf". */
  job: boolean;
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
        title={job ? "Cancel this job" : "Cancel this document"}
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
              {job ? "Cancel job" : "Cancel document"}
            </Button>
          </>
        }
      >
        <p className="mb-5 text-theme-sm text-gray-500 dark:text-gray-400">
          {paid > 0
            ? job
              ? "The advance is accounted for below. A part already ordered for this job is yours to keep as a fee."
              : "The goods go back on the shelf, and the advance is accounted for below."
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

/**
 * HOW MANY, TYPED.
 *
 * A laundry takes in twenty-five shirts, and a workshop puts 3.5 litres of oil
 * in an engine. With only − and + the first was twenty-four presses, each a
 * trip to the server, and the second could not be said at all. The buttons
 * stay for "one more"; the box is for a number. The server still judges it —
 * a part sold by the piece is refused half of one — and a refusal puts the
 * figure that is really on the job back in the box.
 */
function LineQuantity({
  name,
  quantity,
  disabled,
  onChange,
}: {
  name: string;
  quantity: number;
  disabled: boolean;
  onChange: (quantity: number, undo: () => void) => void;
}) {
  const [typed, setTyped] = useState(formatQuantity(quantity));
  useEffect(() => setTyped(formatQuantity(quantity)), [quantity]);

  const commit = () => {
    const q = Number(typed);
    if (typed.trim() === "" || !Number.isFinite(q) || q <= 0) {
      setTyped(formatQuantity(quantity));
      return;
    }
    if (q !== quantity) onChange(q, () => setTyped(formatQuantity(quantity)));
  };

  return (
    <input
      type="number"
      min="0"
      step="any"
      inputMode="decimal"
      aria-label={`How many ${name}`}
      data-testid="job-line-qty"
      value={typed}
      disabled={disabled}
      onChange={(e) => setTyped(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      className="h-7 w-14 rounded-md border border-gray-300 bg-transparent text-center tabular-nums text-gray-700 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200"
    />
  );
}

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

function JobFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-theme-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-0.5 text-gray-800 dark:text-white/90">{children}</div>
    </div>
  );
}
