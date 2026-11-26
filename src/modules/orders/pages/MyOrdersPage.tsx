import { useState } from "react";

import PageMeta from "../../../components/common/PageMeta";
import { Link } from "react-router";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import { useToast } from "../../../components/ui/toast";
import { MarketHeader } from "../../marketplace/components/MarketHeader";
import { MyReservations } from "../../marketplace/components/MyReservations";
import Pager from "../../../components/ui/pager";
import { useCancelMyOrder, useMyOrders, useReportMyIssue } from "../hooks/useOrders";
import type { MyIssueKind } from "../services/ordersService";
import { customerSays } from "../orderFlow";
import { moneyLineValue, orderMoneyLines } from "../orderMoney";
import type { CustomerOrder, OrderStatus } from "../services/ordersService";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { money } from "../../marketplace/components/format";


const STATUS_COLOR: Record<OrderStatus, "success" | "warning" | "info" | "error" | "light"> = {
  pending: "warning", confirmed: "info", preparing: "info", ready: "info",
  out_for_delivery: "info", completed: "success", cancelled: "error",
};

const STEPS: OrderStatus[] = ["pending", "confirmed", "preparing", "out_for_delivery", "completed"];

export default function MyOrdersPage() {
  const confirm = useConfirm();
  // `useMyOrders` has taken a page and kept previous data since it was written.
  // This screen called it with none and rendered no pager, so a buyer who had
  // ordered sixteen times could never look at the first one. The capability was
  // built, tested and wired to nothing — the eighth time that shape has turned
  // up in this repository.
  const [page, setPage] = useState(1);
  const orders = useMyOrders(page);
  const cancel = useCancelMyOrder();
  const toast = useToast();
  const rows = orders.data?.data ?? [];

  // Only while nobody has answered: the server refuses a cancel once the
  // shop has accepted, so offering it then was offering a refusal.
  const canCancel = (o: CustomerOrder) => o.status === "pending";

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-900">
      <PageMeta title="My Orders" description="Your online orders" />
      <MarketHeader />

      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white/90">My Orders</h1>
          <Link to="/shops" className="text-sm text-brand-500 hover:text-brand-600">Browse shops →</Link>
        </div>

        {orders.isLoading ? (
          <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />)}</div>
        ) : rows.length === 0 ? (
          <ListEmpty from={orders} what="your orders">
            <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
              <p className="text-gray-500 dark:text-gray-400">No orders yet.</p>
              <Link to="/shops"><Button size="sm" className="mt-3">Start shopping</Button></Link>
            </div>
          </ListEmpty>
        ) : (
          <div className="space-y-4">
            {rows.map((o) => (
              <div key={o.id} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-gray-800 dark:text-white/90">{o.order_number}</span>
                    <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">{o.shop?.business_name}</span>
                  </div>
                  <Badge color={STATUS_COLOR[o.status]}>{customerSays(o.status, o.fulfillment_type)}</Badge>
                </div>

                {/* Progress tracker (hidden if cancelled) */}
                {o.status !== "cancelled" && (
                  <div className="mb-4 flex items-center gap-1">
                    {STEPS.filter((s) => s !== "out_for_delivery" || o.fulfillment_type === "delivery").map((step) => {
                      const reached = STEPS.indexOf(o.status) >= STEPS.indexOf(step) || o.status === "completed";
                      return <div key={step} className={`h-1.5 flex-1 rounded-full ${reached ? "bg-brand-500" : "bg-gray-200 dark:bg-gray-800"}`} />;
                    })}
                  </div>
                )}

                <div className="mb-3 space-y-1 text-sm text-gray-600 dark:text-gray-300">
                  {(o.items ?? []).map((it, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{it.quantity} × {it.product_name}{it.variant_name ? ` (${it.variant_name})` : ""}</span>
                      <span>{money(it.line_total, o.shop?.currency)}</span>
                    </div>
                  ))}
                  {/* The lines and the total did not add up, and nothing said
                      why: the delivery charge (and any coupon) were in the
                      total and on no line. Now every share the server priced —
                      coupon, offer, member discount, tax, delivery — is a line. */}
                  {orderMoneyLines(o, o.fulfillment_type)
                    .filter((line) => line.kind !== "goods" && line.kind !== "total")
                    .filter((line) => line.kind !== "delivery" || line.amount > 0)
                    .map((line) => (
                      <div key={line.key} className="flex justify-between">
                        <span>{line.label}</span>
                        <span>{moneyLineValue(line, (x) => money(x, o.shop?.currency))}</span>
                      </div>
                    ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 text-sm dark:border-gray-800">
                  <span className="text-gray-500 dark:text-gray-400">
                    {o.fulfillment_type === "delivery" ? `Delivery · ${o.delivery_address ?? ""}` : "Pickup"} ·{" "}
                    {o.payment_method === "transfer" ? "Transfer" : o.payment_method === "paid" ? "Paid" : o.fulfillment_type === "delivery" ? "Cash on delivery" : "Pay at the shop"}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-gray-800 dark:text-white/90">{money(o.total, o.shop?.currency)}</span>
                    {/* A customer cancelling their own order. This said nothing
                        either way — and an order you believe you cancelled but
                        did not is the version of this that costs someone money. */}
                    {canCancel(o) && (
                      <button
                        className={ROW_ACTION_DANGER}
                        disabled={cancel.isPending}
                        onClick={async () => {
                          if (!(await confirm({ title: "Cancel this order?", confirmLabel: "Cancel order", cancelLabel: "Keep it", tone: "danger" }))) return;
                          cancel.mutate(o.id, {
                            onSuccess: () => toast.success("Order cancelled"),
                            onError: (e) =>
                              toast.error(
                                e instanceof Error ? e.message : "Couldn't cancel the order. It may already be on its way.",
                              ),
                          });
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                {/* A transfer: whether the shop has seen the money yet. */}
                {o.payment_method === "transfer" && o.status !== "cancelled" && (
                  <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${o.payment_received ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-400" : "bg-warning-50 text-warning-800 dark:bg-warning-500/10 dark:text-warning-300"}`}>
                    {o.payment_received ? "The shop has received your transfer." : `Waiting for the shop to check your transfer (ref ${o.payment_reference ?? "—"}). It starts once the money shows.`}
                  </p>
                )}

                <IssueBlock order={o} />
              </div>
            ))}
          </div>
        )}

        <Pager pagination={orders.data?.meta?.pagination} onPage={setPage} noun="orders" />

        {/* Reservations a buyer asked for. Renders nothing at all when there
            are none, which is almost everybody — the shop's half of this
            feature has always been complete and the buyer's half was built on
            the server and never called. */}
        <MyReservations />
      </div>
    </div>
  );
}

const ISSUE_KINDS: Array<{ value: MyIssueKind; label: string }> = [
  { value: "missing_item", label: "Something was missing" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "late", label: "Arrived very late" },
  { value: "quality", label: "Food or item quality" },
  { value: "rider", label: "Problem with the rider" },
  { value: "payment", label: "Charged wrongly" },
  { value: "other", label: "Something else" },
];

/**
 * "ORDER MEIN MASLA" on the web — report it once, read the answer here.
 * The same rule as the app: one report per order, while it makes sense.
 */
function IssueBlock({ order: o }: { order: CustomerOrder }) {
  const report = useReportMyIssue();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MyIssueKind | "">("");
  const [note, setNote] = useState("");

  if (o.issue) {
    const i = o.issue;
    return (
      <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${i.status === "open" ? "border-warning-200 dark:border-warning-500/30" : "border-success-200 dark:border-success-500/30"}`} data-testid="my-order-issue">
        <p className="font-medium text-gray-800 dark:text-white/90">
          {i.status === "open" ? `You reported: ${i.kind_label}` : i.outcome === "refund" ? `Refund of ${money(i.amount ?? 0, o.shop?.currency)}` : i.outcome === "voucher" ? `Voucher ${i.voucher_code} · ${money(i.amount ?? 0, o.shop?.currency)}` : "We looked into it"}
        </p>
        <p className="text-gray-600 dark:text-gray-400">{i.status === "open" ? "We are looking into it — the answer will appear here." : i.answer}</p>
      </div>
    );
  }
  if (!o.can_report_issue) return null;
  if (!open) {
    return (
      <button type="button" className="mt-3 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => setOpen(true)}>
        Problem with this order?
      </button>
    );
  }

  const ready = kind !== "" && (kind !== "other" || note.trim() !== "");
  return (
    <div className="mt-3 grid gap-2 rounded-xl bg-gray-50 p-3 dark:bg-white/5 sm:grid-cols-[14rem_1fr_auto]">
      <select
        aria-label="What happened"
        value={kind}
        onChange={(e) => setKind(e.target.value as MyIssueKind)}
        className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
      >
        <option value="">What happened?</option>
        {ISSUE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </select>
      <input
        aria-label="Tell us more"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={kind === "missing_item" ? "Which item was missing?" : "Tell us a little more"}
        className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
      />
      <Button
        size="sm"
        disabled={!ready || report.isPending}
        onClick={() =>
          report.mutate(
            { id: o.id, kind: kind as MyIssueKind, note: note.trim() || undefined },
            {
              onSuccess: () => { toast.success("Thanks — we will look into it and reply here."); setOpen(false); },
              onError: (e) => toast.error(e instanceof Error ? e.message : "That did not go through."),
            },
          )
        }
      >
        Send
      </Button>
    </div>
  );
}
