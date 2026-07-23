import { useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import Select from "../../../components/form/Select";
import Alert from "../../../components/ui/alert/Alert";
import { ApiError } from "../../../common/types/api";
import { Link } from "react-router";
import { useOrderActions, useRiders, useShopOrders } from "../hooks/useOrders";
import type { OrderStatus, OwnerOrder } from "../services/ordersService";


const STATUS_COLOR: Record<OrderStatus, "success" | "warning" | "info" | "error" | "light"> = {
  pending: "warning", confirmed: "info", preparing: "info", ready: "info",
  out_for_delivery: "info", completed: "success", cancelled: "error",
};

// The single "next step" button per status (delivery vs pickup aware).
function nextStep(o: OwnerOrder): { label: string; status: OrderStatus } | null {
  switch (o.status) {
    case "pending": return { label: "Confirm", status: "confirmed" };
    case "confirmed": return { label: "Start preparing", status: "preparing" };
    case "preparing": return o.fulfillment_type === "delivery"
      ? { label: "Out for delivery", status: "out_for_delivery" }
      : { label: "Mark ready", status: "ready" };
    case "ready":
    case "out_for_delivery": return { label: "Complete", status: "completed" };
    default: return null;
  }
}

export default function OwnerOrdersPage() {
  const money = useMoney();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const orders = useShopOrders({ status, page });
  const { advance, cancel, assignRider } = useOrderActions();
  const riders = useRiders();
  const activeRiders = (riders.data ?? []).filter((r) => r.is_active);
  const [error, setError] = useState<string | null>(null);

  const rows = orders.data?.data ?? [];
  const pagination = orders.data?.meta.pagination;

  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : "Action failed.");

  return (
    <>
      <PageMeta title="Orders | ShopOS" description="Online orders" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Online Orders</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Fulfil customer orders — stock is held until you complete or cancel.</p>
        </div>
        <div className="w-48">
          <Select
            options={[
              { value: "", label: "All statuses" },
              { value: "pending", label: "Pending" },
              { value: "confirmed", label: "Confirmed" },
              { value: "preparing", label: "Preparing" },
              { value: "out_for_delivery", label: "Out for delivery" },
              { value: "ready", label: "Ready" },
              { value: "completed", label: "Completed" },
              { value: "cancelled", label: "Cancelled" },
            ]}
            placeholder="All statuses"
            onChange={(v) => { setStatus(v); setPage(1); }}
          />
        </div>
      </div>

      {error && <div className="mb-4"><Alert variant="error" title="Blocked" message={error} /></div>}

      <div className="space-y-4">
        {orders.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />)
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center dark:border-gray-700">
            <p className="text-gray-500 dark:text-gray-400">{status ? "No orders with this status." : "No online orders yet."}</p>
          </div>
        ) : (
          rows.map((o) => {
            const step = nextStep(o);
            return (
              <div key={o.id} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-gray-800 dark:text-white/90">{o.order_number}</span>
                    <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">{o.customer_name}{o.customer_phone ? ` · ${o.customer_phone}` : ""}</span>
                  </div>
                  <Badge color={STATUS_COLOR[o.status]}>{o.status.replace(/_/g, " ")}</Badge>
                </div>

                <div className="mb-3 text-theme-xs text-gray-500 dark:text-gray-400">
                  {o.fulfillment_type === "delivery" ? `🚚 Deliver to: ${o.delivery_address ?? "—"}` : "🏬 Pickup"} · {o.payment_method.toUpperCase()} ({o.payment_status})
                  {o.notes ? ` · "${o.notes}"` : ""}
                </div>

                <div className="mb-3 space-y-1 text-sm text-gray-600 dark:text-gray-300">
                  {o.items.map((it, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{it.quantity} × {it.product_name}{it.variant_name ? ` (${it.variant_name})` : ""}</span>
                      <span>{money(it.line_total)}</span>
                    </div>
                  ))}
                  {Number(o.delivery_fee) > 0 && <div className="flex justify-between text-gray-400"><span>Delivery</span><span>{money(o.delivery_fee)}</span></div>}
                </div>

                {/* Delivery orders: assign one of the shop's own riders. */}
                {o.fulfillment_type === "delivery" && o.status !== "cancelled" && o.status !== "completed" && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-theme-sm dark:border-gray-800">
                    <span className="text-gray-500 dark:text-gray-400">🛵 Rider</span>
                    {activeRiders.length === 0 ? (
                      <Link to="/tenant/riders" className="text-brand-500 hover:text-brand-600">Add a rider →</Link>
                    ) : (
                      <select
                        value={o.rider_id ?? ""}
                        disabled={assignRider.isPending}
                        onChange={(e) => { setError(null); assignRider.mutate({ id: o.id, riderId: e.target.value || null }, { onError }); }}
                        className="h-9 rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm dark:border-gray-700 dark:bg-gray-900"
                      >
                        <option value="">Unassigned</option>
                        {activeRiders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    )}
                    {o.rider && <span className="text-gray-400">assigned to {o.rider.name}</span>}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
                  <span className="font-bold text-gray-800 dark:text-white/90">{money(o.total)}</span>
                  <div className="flex gap-2">
                    {o.status !== "completed" && o.status !== "cancelled" && (
                      <Button size="sm" variant="outline" onClick={() => { setError(null); cancel.mutate({ id: o.id }, { onError }); }}>
                        Cancel
                      </Button>
                    )}
                    {step && (
                      <Button size="sm" onClick={() => { setError(null); advance.mutate({ id: o.id, status: step.status }, { onError }); }} disabled={advance.isPending}>
                        {step.label}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {pagination && pagination.last_page > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-500 dark:text-gray-400">{pagination.total} orders · page {pagination.current_page} of {pagination.last_page}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={pagination.current_page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={pagination.current_page >= pagination.last_page} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </>
  );
}
