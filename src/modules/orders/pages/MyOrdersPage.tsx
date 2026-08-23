import { useState } from "react";

import PageMeta from "../../../components/common/PageMeta";
import { Link } from "react-router";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import { useToast } from "../../../components/ui/toast";
import { MarketHeader } from "../../marketplace/components/MarketHeader";
import { MyReservations } from "../../marketplace/components/MyReservations";
import Pager from "../../../components/ui/pager";
import { useCancelMyOrder, useMyOrders } from "../hooks/useOrders";
import type { CustomerOrder, OrderStatus } from "../services/ordersService";
import { useConfirm } from "../../../components/ui/confirm";
import { ROW_ACTION_DANGER } from "../../../components/ui/table/rowAction";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

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

  const canCancel = (o: CustomerOrder) => o.status === "pending" || o.status === "confirmed";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <PageMeta title="My Orders | CartZe" description="Your online orders" />
      <MarketHeader />

      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white/90">My Orders</h1>
          <Link to="/" className="text-sm text-brand-500 hover:text-brand-600">Browse shops →</Link>
        </div>

        {orders.isLoading ? (
          <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />)}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">No orders yet.</p>
            <Link to="/"><Button size="sm" className="mt-3">Start shopping</Button></Link>
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((o) => (
              <div key={o.id} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-gray-800 dark:text-white/90">{o.order_number}</span>
                    <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">{o.shop?.business_name}</span>
                  </div>
                  <Badge color={STATUS_COLOR[o.status]}>{o.status.replace(/_/g, " ")}</Badge>
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
                  {o.items.map((it, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{it.quantity} × {it.product_name}{it.variant_name ? ` (${it.variant_name})` : ""}</span>
                      <span>{money(it.line_total)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 text-sm dark:border-gray-800">
                  <span className="text-gray-500 dark:text-gray-400">
                    {o.fulfillment_type === "delivery" ? `Delivery · ${o.delivery_address ?? ""}` : "Pickup"} · {o.payment_method.toUpperCase()}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-gray-800 dark:text-white/90">{money(o.total)}</span>
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
