import { formatQuantity } from "../../../common/format/quantity";
import { elapsedLabel, urgencyOf } from "../../../common/time/elapsed";
import { STAGE } from "./orderStage";
import type { OwnerOrder } from "../services/ordersService";

/**
 * The columns this row draws.
 *
 * Exported so the header, the skeletons and the empty state all span the same
 * number. Three places counting to nine independently is three places that can
 * be wrong, and the symptom is a "nothing here" message sitting under half the
 * table.
 */
export const ORDER_COLUMNS = 9;

/**
 * ONE ORDER, AS A ROW.
 *
 * ── Why this replaced a card ───────────────────────────────────────────
 *
 * The first version of this screen drew a card per order: every item, the
 * address, the notes, the rider picker and both buttons, all of it, always.
 * Four orders filled a laptop screen. A shop working a lunch rush has forty,
 * and scrolling past everything it already knows to find the one that needs
 * doing is the opposite of what a queue is for.
 *
 * So the row carries only what is needed to CHOOSE — who, how long, how much,
 * where it is up to — and everything else is one click away. That is the shape
 * every order screen worth copying has, and for the same reason.
 *
 * ── What earns its place in the row ────────────────────────────────────
 *
 *   the stage      as a dot, so a column can be read without reading it
 *   the number     what a customer quotes on the phone
 *   the age        the fact that decides which one to pick up, coloured
 *   the customer   who it is for
 *   what and how   item count, delivery or pickup, whether it is paid
 *   the total      right-aligned and tabular, so a column of them adds up
 *   the next step  the one forward move, without opening anything
 */
export function OrderRow({
  order,
  money,
  busy,
  onOpen,
  onAdvance,
  nextLabel,
}: {
  order: OwnerOrder;
  money: (n: string | number) => string;
  busy: boolean;
  onOpen: () => void;
  onAdvance: () => void;
  /** The single forward move, or null once the order is finished. */
  nextLabel: string | null;
}) {
  const stage = STAGE[order.status];
  const urgency = urgencyOf(order.placed_at, order.status);
  const delivery = order.fulfillment_type === "delivery";
  const open = order.status !== "completed" && order.status !== "cancelled";
  const needsRider = delivery && open && order.rider_id === null;
  const items = order.items.reduce((n, i) => n + Number(formatQuantity(i.quantity) || 0), 0);

  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer text-theme-sm text-gray-700 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.04]"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${stage.dot}`} />
          <button
            type="button"
            // The row is clickable, and so is this — a link-looking thing that
            // is not itself pressable is the control people report as broken.
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="min-h-9 rounded-lg px-1 font-medium text-brand-500 transition hover:bg-brand-50 hover:text-brand-600 dark:text-brand-400 dark:hover:bg-brand-500/10"
          >
            {order.order_number}
          </button>
        </div>
      </td>

      <td className="whitespace-nowrap px-4 py-3">
        <span
          className={`rounded-md px-1.5 py-0.5 text-theme-xs font-semibold tabular-nums ${
            urgency === "late"
              ? "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400"
              : urgency === "warm"
                ? "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400"
                : "text-gray-500 dark:text-gray-400"
          }`}
          title={new Date(order.placed_at).toLocaleString()}
        >
          {elapsedLabel(order.placed_at)}
        </span>
      </td>

      <td className="max-w-44 px-4 py-3">
        <span className="block truncate font-medium text-gray-800 dark:text-white/90">
          {order.customer_name}
        </span>
        {/* On a phone the "how" and "items" columns are gone, so the two
            facts worth keeping move under the name rather than being lost. */}
        <span className="block truncate text-theme-xs text-gray-400">
          {/* Each separator belongs to the fragment it precedes, so a hidden
              fragment takes its own "·" with it. Written the other way round,
              1024px read "Pickup · " with nothing after the dot. */}
          <span className="xl:hidden">{delivery ? "Delivery" : "Pickup"}</span>
          <span className="sm:hidden"> · {items} {items === 1 ? "item" : "items"}</span>
          {order.channel && order.channel !== "online" && (
            <span className="capitalize"> · {order.channel.replace("_", " ")}</span>
          )}
        </span>
      </td>

      <td className="hidden whitespace-nowrap px-4 py-3 text-theme-xs text-gray-500 sm:table-cell dark:text-gray-400">
        {items} {items === 1 ? "item" : "items"}
      </td>

      <td className="hidden whitespace-nowrap px-4 py-3 xl:table-cell">
        <span className="text-theme-xs text-gray-600 dark:text-gray-300">
          {delivery ? "Delivery" : "Pickup"}
        </span>
        {needsRider && (
          // The one row-level warning worth the space: an order out for
          // delivery with nobody carrying it is a customer waiting for a bike
          // that was never sent.
          <span className="ml-1.5 rounded-md bg-warning-50 px-1.5 py-0.5 text-theme-xs font-medium text-warning-700 dark:bg-warning-500/15 dark:text-warning-400">
            no rider
          </span>
        )}
      </td>

      <td className="hidden whitespace-nowrap px-4 py-3 xl:table-cell">
        <span
          className={`text-theme-xs font-medium ${
            order.payment_status === "paid"
              ? "text-success-600 dark:text-success-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {order.payment_status === "paid" ? "Paid" : order.payment_method.toUpperCase()}
        </span>
      </td>

      <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-gray-800 dark:text-white/90">
        {money(order.total)}
      </td>

      <td className="whitespace-nowrap px-4 py-3">
        <span className={`rounded-lg px-2 py-1 text-theme-xs font-semibold ${stage.chip}`}>
          {stage.short}
        </span>
      </td>

      <td className="hidden whitespace-nowrap px-4 py-3 text-right sm:table-cell">
        {nextLabel !== null && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdvance(); }}
            disabled={busy}
            className="min-h-9 rounded-lg border border-brand-200 bg-brand-50 px-3 text-theme-xs font-semibold text-brand-700 transition hover:bg-brand-100 disabled:opacity-40 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
          >
            {nextLabel}
          </button>
        )}
        <span className="sr-only">Open order {order.order_number}</span>
      </td>

    </tr>
  );
}
