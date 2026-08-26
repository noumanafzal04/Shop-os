import { useState } from "react";
import { Link } from "react-router";

import { formatQuantity } from "../../../common/format/quantity";
import { elapsedLabel, urgencyOf } from "../../../common/time/elapsed";
import Badge from "../../../components/ui/badge/Badge";
import Button from "../../../components/ui/button/Button";
import { nextStep } from "../orderFlow";
import type { OrderStatus, OwnerOrder, Rider } from "../services/ordersService";

const STAGE: Record<OrderStatus, { label: string; stripe: string; chip: string }> = {
  pending: { label: "Waiting to be confirmed", stripe: "bg-warning-400", chip: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400" },
  confirmed: { label: "Confirmed", stripe: "bg-blue-light-400", chip: "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/15 dark:text-blue-light-400" },
  preparing: { label: "Being prepared", stripe: "bg-brand-400", chip: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" },
  ready: { label: "Ready for collection", stripe: "bg-success-400", chip: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400" },
  out_for_delivery: { label: "Out for delivery", stripe: "bg-brand-500", chip: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" },
  completed: { label: "Completed", stripe: "bg-gray-300 dark:bg-gray-700", chip: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" },
  cancelled: { label: "Cancelled", stripe: "bg-error-400", chip: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400" },
};

/** How many item lines fit before the card stops being scannable. */
const LINES_SHOWN = 3;

/**
 * ONE ORDER, AS A THING SOMEBODY HAS TO ACT ON.
 *
 * ── What the old card did not say ──────────────────────────────────────
 *
 * The time. Not the age, not the clock — nothing. A queue whose whole purpose
 * is "what needs doing next" printed the order number, the customer, the items
 * and the total, and left the single fact that decides which one to pick up
 * entirely off the screen. A shop worked it out by remembering.
 *
 * So the age is the second thing on the card, and it COLOURS: five minutes
 * unconfirmed is fine, twenty is not, and the thresholds are per stage because
 * fifteen minutes on a bike is normal and fifteen minutes unacknowledged is a
 * customer deciding to ring somebody else.
 *
 * ── The other three ────────────────────────────────────────────────────
 *
 *   · The phone number is a `tel:` link. A shop rings the customer when
 *     something is wrong with an order; it was text to be copied out by hand.
 *   · A long order collapses. Fourteen lines pushed the next-step button off
 *     the fold, so the control the screen exists for was the hardest thing on
 *     it to reach.
 *   · The stripe down the left is the stage, so a column of cards can be read
 *     without reading any of them.
 */
export function OrderCard({
  order,
  money,
  riders,
  branchLabel,
  busy,
  onAdvance,
  onCancel,
  onAssignRider,
}: {
  order: OwnerOrder;
  money: (n: string | number) => string;
  /** Active riders only. Empty = this shop has none yet. */
  riders: Rider[];
  /** Null when the shop has one branch and naming it would be noise. */
  branchLabel: string | null;
  busy: boolean;
  onAdvance: (status: OrderStatus) => void;
  onCancel: () => void;
  onAssignRider: (riderId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const stage = STAGE[order.status];
  const step = nextStep(order);
  const open = order.status !== "completed" && order.status !== "cancelled";
  const urgency = urgencyOf(order.placed_at, order.status);
  const delivery = order.fulfillment_type === "delivery";
  const needsRider = delivery && open && order.rider_id === null;

  const lines = expanded ? order.items : order.items.slice(0, LINES_SHOWN);
  const hidden = order.items.length - lines.length;

  return (
    <article
      className={`relative overflow-hidden rounded-2xl border bg-white pl-4 transition dark:bg-white/[0.03] ${
        urgency === "late"
          ? "border-error-300 dark:border-error-500/40"
          : "border-gray-200 dark:border-gray-800"
      }`}
    >
      {/* The stage, readable without reading the card. */}
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${stage.stripe}`} />

      <div className="p-4 sm:p-5">
        <header className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-800 dark:text-white/90">{order.order_number}</span>

              {/* THE FACT THIS SCREEN WAS MISSING. */}
              <span
                className={`rounded-md px-1.5 py-0.5 text-theme-xs font-semibold tabular-nums ${
                  urgency === "late"
                    ? "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400"
                    : urgency === "warm"
                      ? "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400"
                      : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400"
                }`}
                title={new Date(order.placed_at).toLocaleString()}
              >
                {elapsedLabel(order.placed_at)}
              </span>

              {/* Which door it came through. A shop asking whether the online
                  storefront earns its keep cannot get an answer from a list
                  that treats a call and a checkout alike. */}
              {order.channel && order.channel !== "online" && (
                <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-theme-xs font-medium capitalize text-gray-500 dark:bg-white/10 dark:text-gray-400">
                  {order.channel.replace("_", " ")}
                </span>
              )}
            </div>

            <p className="mt-1 truncate text-theme-sm text-gray-600 dark:text-gray-300">
              {order.customer_name}
              {order.customer_phone && (
                <>
                  {" · "}
                  {/* A shop rings the customer when something is wrong. This
                      was text to be copied out by hand. */}
                  <a
                    href={`tel:${order.customer_phone}`}
                    className="font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400"
                  >
                    {order.customer_phone}
                  </a>
                </>
              )}
            </p>
          </div>

          <span className={`shrink-0 rounded-lg px-2.5 py-1 text-theme-xs font-semibold ${stage.chip}`}>
            {stage.label}
          </span>
        </header>

        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-theme-xs text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1.5 font-medium">
            {delivery ? "Delivery" : "Pickup"}
          </span>
          <span aria-hidden>·</span>
          <span className="uppercase">{order.payment_method}</span>
          <Badge size="sm" color={order.payment_status === "paid" ? "success" : "light"}>
            {order.payment_status}
          </Badge>
          {/* WHICH BRANCH IS FILLING IT. A chain picks the nearest branch that
              holds the whole basket, so the shop putting this together is not
              necessarily the one reading the screen — and for a pickup it is
              where the customer will turn up. Whether it is worth saying at all
              is decided in one place; see useBranchColumn. */}
          {branchLabel && (
            <>
              <span aria-hidden>·</span>
              <span>{branchLabel}</span>
            </>
          )}
        </div>

        {delivery && order.delivery_address && (
          <p className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-theme-sm text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">
            {order.delivery_address}
          </p>
        )}

        {order.notes && (
          <p className="mb-3 rounded-lg border border-warning-200 bg-warning-25 px-3 py-2 text-theme-sm italic text-warning-800 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
            “{order.notes}”
          </p>
        )}

        <ul className="mb-3 space-y-1 text-theme-sm text-gray-600 dark:text-gray-300">
          {lines.map((it, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="font-medium text-gray-800 tabular-nums dark:text-white/90">{formatQuantity(it.quantity)}×</span>{" "}
                {it.product_name}
                {it.variant_name ? ` (${it.variant_name})` : ""}
              </span>
              <span className="shrink-0 tabular-nums">{money(it.line_total)}</span>
            </li>
          ))}
          {hidden > 0 && (
            <li>
              {/* A fourteen-line order used to push the next-step button off
                  the fold — the one control this screen exists for. */}
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="rounded-md px-1 py-0.5 text-theme-xs font-semibold text-brand-500 transition hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-500/10"
              >
                + {hidden} more {hidden === 1 ? "item" : "items"}
              </button>
            </li>
          )}
          {Number(order.delivery_fee) > 0 && (
            <li className="flex justify-between gap-3 text-gray-400">
              <span>Delivery</span>
              <span className="tabular-nums">{money(order.delivery_fee)}</span>
            </li>
          )}
        </ul>

        {delivery && open && (
          <div className="mb-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-theme-sm dark:border-gray-800">
            <span className={needsRider ? "font-semibold text-warning-700 dark:text-warning-400" : "text-gray-500 dark:text-gray-400"}>
              {needsRider ? "No rider yet" : "Rider"}
            </span>
            {riders.length === 0 ? (
              <Link to="/tenant/riders" className="font-medium text-brand-500 hover:text-brand-600">
                Add a rider →
              </Link>
            ) : (
              <select
                value={order.rider_id ?? ""}
                disabled={busy}
                aria-label={`Rider for ${order.order_number}`}
                onChange={(e) => onAssignRider(e.target.value || null)}
                className={`h-9 rounded-lg border bg-transparent px-2 text-theme-sm dark:bg-gray-900 ${
                  needsRider
                    ? "border-warning-300 text-warning-800 dark:border-warning-500/40 dark:text-warning-300"
                    : "border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-200"
                }`}
              >
                <option value="">Unassigned</option>
                {riders.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
          <span className="text-lg font-bold tabular-nums text-gray-800 dark:text-white/90">
            {money(order.total)}
          </span>
          <div className="flex gap-2">
            {open && (
              <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            )}
            {step && (
              <Button size="sm" onClick={() => onAdvance(step.status)} disabled={busy}>
                {step.label}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </article>
  );
}

/** A card-shaped placeholder, so the queue does not jump as it loads. */
export function OrderCardSkeleton() {
  return (
    <div className="h-56 animate-pulse rounded-2xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-800/60" />
  );
}
