import { useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Alert from "../../../components/ui/alert/Alert";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import Select from "../../../components/form/Select";
import { Modal } from "../../../components/ui/modal";
import { useModal } from "../../../hooks/useModal";
import { ApiError } from "../../../common/types/api";
import { useReservationMutations, useReservations } from "../hooks/useReservations";
import type { Reservation, ReservationStatus } from "../services/reservationsService";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";


const STATUS_COLOR: Record<ReservationStatus, "success" | "warning" | "error" | "info" | "light"> = {
  pending: "warning",
  accepted: "info",
  completed: "success",
  rejected: "error",
  cancelled: "light",
  expired: "light",
};

export default function ReservationsPage() {
  const confirm = useConfirm();
  const money = useMoney();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const reservations = useReservations({ status, page });
  const { accept, reject, complete } = useReservationMutations();

  const completeModal = useModal();
  const [target, setTarget] = useState<Reservation | null>(null);
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [actionError, setActionError] = useState<string | null>(null);

  const rows = reservations.data?.data ?? [];
  const pagination = reservations.data?.meta.pagination;

  const handleError = (error: unknown) =>
    setActionError(error instanceof ApiError ? error.message : "Action failed.");

  const doAccept = (r: Reservation) => {
    setActionError(null);
    accept.mutate(r.id, { onError: handleError });
  };

  const doReject = async (r: Reservation) => {
    setActionError(null);
    // null is "changed my mind"; an empty string is "reject it, no reason
    // given". They are different answers and the dialog is typed to keep them
    // apart — a native prompt could only ever return one of them clearly.
    const reason = await confirm({
      title: `Reject ${r.customer?.name ?? "this booking"}?`,
      message: "The customer is told it was not accepted.",
      confirmLabel: "Reject",
      tone: "danger",
      input: { label: "Reason", placeholder: "Nothing available that day…" },
    });
    if (reason === null) return;
    reject.mutate({ id: r.id, reason: reason.trim() || undefined }, { onError: handleError });
  };

  const openComplete = (r: Reservation) => {
    setTarget(r);
    setAmountPaid(String(Number(r.unit_price) * r.quantity));
    setPaymentMethod("cash");
    setActionError(null);
    completeModal.openModal();
  };

  const doComplete = () => {
    if (!target || complete.isPending) return;
    complete.mutate(
      { id: target.id, payment_method: paymentMethod, amount_paid: Number(amountPaid) },
      { onSuccess: completeModal.closeModal, onError: handleError },
    );
  };

  return (
    <>
      <PageMeta title="Reservations | ShopOS" description="Customer reservations" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Reservations</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Accepting a reservation puts stock on hold until pickup or expiry.
          </p>
        </div>
        <div className="w-48">
          <Select
            options={[
              { value: "", label: "All statuses" },
              { value: "pending", label: "Pending" },
              { value: "accepted", label: "Accepted" },
              { value: "completed", label: "Completed" },
              { value: "rejected", label: "Rejected" },
              { value: "cancelled", label: "Cancelled" },
              { value: "expired", label: "Expired" },
            ]}
            placeholder="All statuses"
            onChange={(v) => { setStatus(v); setPage(1); }}
          />
        </div>
      </div>

      {actionError && (
        <div className="mb-4">
          <Alert variant="error" title="Action blocked" message={actionError} />
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Item</th>
                <th className="px-6 py-3 font-medium">Customer</th>
                <th className="px-6 py-3 font-medium">Qty</th>
                <th className="px-6 py-3 font-medium">Value</th>
                <th className="px-6 py-3 font-medium">Expires</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {reservations.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-6 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    {status ? "No reservations with this status." : "No reservations yet."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4">
                      <span className="font-medium text-gray-800 dark:text-white/90">{r.product_name}</span>
                      {r.variant_name && <span className="text-gray-400"> / {r.variant_name}</span>}
                      {r.notes && <div className="text-theme-xs text-gray-400">"{r.notes}"</div>}
                    </td>
                    <td className="px-6 py-4">
                      {r.customer?.name ?? "—"}
                      {r.customer?.phone && (
                        <div className="text-theme-xs text-gray-400">{r.customer.phone}</div>
                      )}
                    </td>
                    <td className="px-6 py-4">{r.quantity}</td>
                    <td className="px-6 py-4">{money(Number(r.unit_price) * r.quantity)}</td>
                    <td className="px-6 py-4 text-theme-xs">
                      {new Date(r.expires_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <Badge size="sm" color={STATUS_COLOR[r.status]}>{r.status}</Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {r.status === "pending" && (
                        <>
                          <button
                            className="mr-3 text-success-500 hover:text-success-600"
                            onClick={() => doAccept(r)}
                            disabled={accept.isPending}
                          >
                            Accept
                          </button>
                          <button
                            className={ROW_ACTION_DANGER}
                            onClick={() => doReject(r)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {r.status === "accepted" && (
                        <>
                          <button
                            className="mr-3 text-brand-500 hover:text-brand-600"
                            onClick={() => openComplete(r)}
                          >
                            Complete sale
                          </button>
                          <button
                            className={ROW_ACTION_DANGER}
                            onClick={() => doReject(r)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3 text-sm dark:border-gray-800">
            <span className="text-gray-500 dark:text-gray-400">
              {pagination.total} reservations · page {pagination.current_page} of {pagination.last_page}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pagination.current_page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={pagination.current_page >= pagination.last_page} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Complete → sale */}
      <Modal isOpen={completeModal.isOpen} onClose={completeModal.closeModal} className="max-w-md p-6">
        <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">
          Complete reservation
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {target?.product_name} × {target?.quantity} — creates the sale at the
          reserved price ({target ? money(target.unit_price) : ""} each).
        </p>

        {actionError && (
          <div className="mb-4">
            <Alert variant="error" title="Blocked" message={actionError} />
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <Label>Payment method</Label>
            <Select
              options={[
                { value: "cash", label: "Cash" },
                { value: "card", label: "Card" },
                { value: "bank_transfer", label: "Bank transfer" },
                { value: "other", label: "Other" },
              ]}
              placeholder="Cash"
              onChange={setPaymentMethod}
            />
          </div>
          <div>
            <Label>Amount paid</Label>
            <Input
              type="number"
              min="0"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button size="sm" variant="outline" onClick={completeModal.closeModal}>Cancel</Button>
          <Button size="sm" onClick={doComplete} disabled={complete.isPending || !amountPaid}>
            {complete.isPending ? "Completing…" : "Complete sale"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
