import { Link } from "react-router";

import { formatQuantity } from "../../../common/format/quantity";
import { elapsedLabel, urgencyOf } from "../../../common/time/elapsed";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import { Modal } from "../../../components/ui/modal";
import { nextStep } from "../orderFlow";
import { STAGE } from "./orderStage";
import type { OrderStatus, OwnerOrder, Rider } from "../services/ordersService";

/**
 * ONE ORDER IN FULL — opened from a row, never drawn in the list.
 *
 * The list carries what is needed to CHOOSE an order. This carries everything
 * needed to WORK it: every line, the address, the note the customer left, who
 * is carrying it, and the two actions that move it.
 *
 * Splitting them that way is the whole point of the change. Drawing all of
 * this per order meant four orders filled a laptop screen, and a shop with
 * forty spent the lunch rush scrolling past things it already knew.
 */
export function OrderDetail({
  order,
  money,
  riders,
  branchLabel,
  busy,
  onClose,
  onAdvance,
  onCancel,
  onAssignRider,
}: {
  order: OwnerOrder | null;
  money: (n: string | number) => string;
  riders: Rider[];
  branchLabel: string | null;
  busy: boolean;
  onClose: () => void;
  onAdvance: (status: OrderStatus) => void;
  onCancel: () => void;
  onAssignRider: (riderId: string | null) => void;
}) {
  if (order === null) return <Modal isOpen={false} onClose={onClose}><span /></Modal>;

  const stage = STAGE[order.status];
  const step = nextStep(order);
  const open = order.status !== "completed" && order.status !== "cancelled";
  const urgency = urgencyOf(order.placed_at, order.status);
  const delivery = order.fulfillment_type === "delivery";
  const needsRider = delivery && open && order.rider_id === null;

  return (
    <Modal isOpen onClose={onClose} className="max-w-2xl p-0">
      <header className="border-b border-gray-100 px-6 py-5 dark:border-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/* The Modal names itself from the first heading it finds, so this
                is what a screen reader announces when it opens. */}
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              {order.order_number}
            </h3>
            <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">
              Placed {new Date(order.placed_at).toLocaleString()}
              {" · "}
              <span
                className={
                  urgency === "late"
                    ? "font-semibold text-error-600 dark:text-error-400"
                    : urgency === "warm"
                      ? "font-semibold text-warning-600 dark:text-warning-400"
                      : ""
                }
              >
                {elapsedLabel(order.placed_at)} ago
              </span>
            </p>
          </div>
          <span className={`shrink-0 rounded-lg px-2.5 py-1 text-theme-xs font-semibold ${stage.chip}`}>
            {stage.label}
          </span>
        </div>
      </header>

      <div className="max-h-[60dvh] overflow-y-auto px-6 py-5">
        <section className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Customer">
            <p className="font-medium text-gray-800 dark:text-white/90">{order.customer_name}</p>
            {order.customer_phone && (
              // A shop rings the customer when an order is wrong. This was
              // text to be copied out by hand.
              <a
                href={`tel:${order.customer_phone}`}
                className="text-theme-sm font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400"
              >
                {order.customer_phone}
              </a>
            )}
            {order.channel && order.channel !== "online" && (
              <p className="text-theme-xs capitalize text-gray-400">
                Came in by {order.channel.replace("_", " ")}
              </p>
            )}
          </Field>

          <Field label={delivery ? "Deliver to" : "Collecting from"}>
            {delivery ? (
              <p className="text-theme-sm text-gray-700 dark:text-gray-300">
                {order.delivery_address ?? <span className="text-gray-400">No address on the order</span>}
              </p>
            ) : (
              <p className="text-theme-sm text-gray-700 dark:text-gray-300">
                {/* WHICH BRANCH IS FILLING IT. A chain picks the nearest one
                    holding the whole basket, so for a pickup this is where the
                    customer will actually turn up. */}
                {branchLabel ?? "the shop"}
              </p>
            )}
            {delivery && branchLabel && (
              <p className="text-theme-xs text-gray-400">Filled by {branchLabel}</p>
            )}
          </Field>

          <Field label="Payment">
            <p className="text-theme-sm text-gray-700 dark:text-gray-300">
              <span className="uppercase">{order.payment_method}</span>{" "}
              <Badge size="sm" color={order.payment_status === "paid" ? "success" : "light"}>
                {order.payment_status}
              </Badge>
            </p>
          </Field>

          {order.notes && (
            <Field label="What they asked for">
              <p className="rounded-lg border border-warning-200 bg-warning-25 px-3 py-2 text-theme-sm italic text-warning-800 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
                “{order.notes}”
              </p>
            </Field>
          )}
        </section>

        <section className="mb-5">
          <h4 className="mb-2 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">
            The order
          </h4>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {order.items.map((it, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-theme-sm">
                <span className="min-w-0 text-gray-700 dark:text-gray-300">
                  <span className="font-medium tabular-nums text-gray-800 dark:text-white/90">
                    {formatQuantity(it.quantity)}×
                  </span>{" "}
                  {it.product_name}
                  {it.variant_name ? ` (${it.variant_name})` : ""}
                </span>
                <span className="shrink-0 tabular-nums text-gray-700 dark:text-gray-300">
                  {money(it.line_total)}
                </span>
              </li>
            ))}
            {Number(order.delivery_fee) > 0 && (
              <li className="flex justify-between gap-3 px-3.5 py-2.5 text-theme-sm text-gray-500 dark:text-gray-400">
                <span>Delivery</span>
                <span className="tabular-nums">{money(order.delivery_fee)}</span>
              </li>
            )}
            <li className="flex justify-between gap-3 bg-gray-50 px-3.5 py-3 dark:bg-white/[0.04]">
              <span className="font-semibold text-gray-800 dark:text-white/90">Total</span>
              <span className="text-lg font-bold tabular-nums text-gray-800 dark:text-white/90">
                {money(order.total)}
              </span>
            </li>
          </ul>
        </section>

        {delivery && open && (
          <section>
            <h4 className="mb-2 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">
              Rider
            </h4>
            {riders.length === 0 ? (
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                This shop has no riders yet.{" "}
                <Link to="/tenant/riders" className="font-medium text-brand-500 hover:text-brand-600">
                  Add one →
                </Link>
              </p>
            ) : (
              <select
                value={order.rider_id ?? ""}
                disabled={busy}
                aria-label={`Rider for ${order.order_number}`}
                onChange={(e) => onAssignRider(e.target.value || null)}
                className={`h-11 w-full rounded-xl border bg-transparent px-3 text-theme-sm dark:bg-gray-900 ${
                  needsRider
                    ? "border-warning-300 text-warning-800 dark:border-warning-500/40 dark:text-warning-300"
                    : "border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-200"
                }`}
              >
                <option value="">Nobody yet</option>
                {riders.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}
          </section>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2.5 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
        <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
        {open && (
          <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel order
          </Button>
        )}
        {step && (
          <Button size="sm" onClick={() => onAdvance(step.status)} disabled={busy}>
            {step.label}
          </Button>
        )}
      </footer>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      {children}
    </div>
  );
}
