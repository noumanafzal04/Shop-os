import { shopDateTime } from "../../../common/format/date";
import { elapsedLabel, urgencyOf } from "../../../common/time/elapsed";
import { BOARD, cameBy, linesOf, onTheBoard, type BoardColumn } from "../orderBoard";
import { nextStep } from "../orderFlow";
import type { OrderStatus, OwnerOrder } from "../services/ordersService";

/**
 * THE ORDERS STILL BEING WORKED — a board, not a list.
 *
 * Four columns in the order work moves: new, accepted, being prepared, ready or
 * on the way. A card says what is in the order, who it is for, how long it has
 * waited and what it comes to — and carries the ONE button for its next step,
 * full width, where a thumb finds it. On a phone the columns stack and an empty
 * one is not drawn.
 *
 * It does not replace the list: finished orders, and looking for one order
 * among hundreds, are still a table's job.
 */

const TONE: Record<BoardColumn["key"], { panel: string; dot: string; count: string }> = {
  new: {
    panel: "border-warning-200 bg-warning-25 dark:border-warning-500/30 dark:bg-warning-500/5",
    dot: "bg-warning-500",
    count: "bg-warning-500 text-white",
  },
  confirmed: {
    panel: "border-blue-light-200 bg-blue-light-25 dark:border-blue-light-500/30 dark:bg-blue-light-500/5",
    dot: "bg-blue-light-500",
    count: "bg-blue-light-500 text-white",
  },
  preparing: {
    panel: "border-orange-200 bg-orange-25 dark:border-orange-500/30 dark:bg-orange-500/5",
    dot: "bg-orange-500",
    count: "bg-orange-500 text-white",
  },
  leaving: {
    panel: "border-success-200 bg-success-25 dark:border-success-500/30 dark:bg-success-500/5",
    dot: "bg-success-500",
    count: "bg-success-500 text-white",
  },
};

export function OrderBoard({ orders, money, busy, onOpen, onAdvance }: {
  orders: OwnerOrder[];
  money: (n: string | number) => string;
  busy: boolean;
  onOpen: (order: OwnerOrder) => void;
  onAdvance: (order: OwnerOrder, to: OrderStatus) => void;
}) {
  const board = onTheBoard(orders);

  return (
    <div data-testid="order-board" className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 2xl:grid-cols-4">
      {BOARD.map((column) => {
        const list = board[column.key];
        const tone = TONE[column.key];

        return (
          <section
            key={column.key}
            aria-label={column.title}
            // A column with nothing in it is not drawn on a phone: four
            // headings saying "nothing" is a screen of nothing.
            className={`min-w-0 rounded-2xl border ${tone.panel} ${list.length === 0 ? "hidden md:block" : ""}`}
          >
            <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
              <h2 className="flex min-w-0 items-center gap-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${tone.dot}`} />
                <span className="truncate">{column.title}</span>
              </h2>
              <span
                aria-label={`${list.length} ${list.length === 1 ? "order" : "orders"}`}
                className={`grid h-6 min-w-6 shrink-0 place-items-center rounded-full px-1.5 text-theme-xs font-bold tabular-nums ${list.length > 0 ? tone.count : "bg-gray-200 text-gray-500 dark:bg-white/10 dark:text-gray-400"}`}
              >
                {list.length}
              </span>
            </header>

            {/* `data-rows` says this is a list of records — to whatever counts
                what a screen is showing, which a table says by being one. */}
            <div data-rows={list.length > 0 ? "" : undefined} className="space-y-2.5 px-2.5 pb-2.5">
              {list.length === 0 ? (
                <p className="px-2 py-6 text-center text-theme-xs text-gray-500 dark:text-gray-400">
                  Nothing waiting {column.waitsFor}.
                </p>
              ) : (
                list.map((order) => (
                  <OrderCard key={order.id} order={order} money={money} busy={busy} onOpen={() => onOpen(order)} onAdvance={(to) => onAdvance(order, to)} />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function OrderCard({ order, money, busy, onOpen, onAdvance }: {
  order: OwnerOrder;
  money: (n: string | number) => string;
  busy: boolean;
  onOpen: () => void;
  onAdvance: (to: OrderStatus) => void;
}) {
  const urgency = urgencyOf(order.placed_at, order.status);
  const delivery = order.fulfillment_type === "delivery";
  const { lines, more } = linesOf(order);
  const step = nextStep(order);
  const by = cameBy(order.channel);
  const paid = order.payment_status === "paid";

  return (
    <article
      data-order={order.order_number}
      onClick={onOpen}
      className="cursor-pointer rounded-xl border border-gray-200 bg-white p-3.5 shadow-theme-xs transition hover:border-brand-300 hover:shadow-theme-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="-ml-1 min-h-9 rounded-lg px-1 text-theme-sm font-semibold text-brand-600 transition hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
        >
          {order.order_number}
        </button>
        {/* How long it has waited — coloured when that is too long for where it is. */}
        <span
          title={shopDateTime(order.placed_at)}
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-theme-xs font-semibold tabular-nums ${
            urgency === "late"
              ? "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400"
              : urgency === "warm"
                ? "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400"
                : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"
          }`}
        >
          {elapsedLabel(order.placed_at)}
        </span>
      </div>

      <p className="mt-1.5 text-theme-sm font-semibold text-gray-900 dark:text-white/90">
        {order.customer_name}
        {by !== null && <span className="ml-1.5 text-theme-xs font-normal text-gray-500 dark:text-gray-400">· {by}</span>}
      </p>

      {/* WHAT IS IN IT, without opening it. */}
      {lines.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-theme-sm text-gray-700 dark:text-gray-300">
          {lines.map((line, at) => <li key={at} className="truncate">{line}</li>)}
          {more > 0 && <li className="text-theme-xs text-gray-500 dark:text-gray-400">+ {more} more</li>}
        </ul>
      )}
      {order.notes && (
        <p className="mt-1.5 line-clamp-2 text-theme-xs italic text-gray-600 dark:text-gray-400">“{order.notes}”</p>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-theme-xs text-gray-600 dark:text-gray-400">
        <span className="font-medium text-gray-700 dark:text-gray-300">{delivery ? "Delivery" : "Pickup"}</span>
        {delivery && (
          order.rider ? (
            <span>· {order.rider.name}</span>
          ) : (
            <span className="rounded-md bg-warning-50 px-1.5 py-0.5 font-medium text-warning-700 dark:bg-warning-500/15 dark:text-warning-400">no rider</span>
          )
        )}
      </p>

      <div className="mt-3 flex items-end justify-between gap-2 border-t border-gray-100 pt-2.5 dark:border-gray-800">
        <span className="text-base font-bold tabular-nums text-gray-900 dark:text-white">{money(order.total)}</span>
        <span className={`text-theme-xs font-medium ${paid ? "text-success-600 dark:text-success-400" : "text-gray-500 dark:text-gray-400"}`}>
          {paid ? "Paid" : delivery ? "Cash on delivery" : "Pays when collecting"}
        </span>
      </div>

      {step !== null && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAdvance(step.status); }}
          disabled={busy}
          className="mt-2.5 min-h-11 w-full rounded-lg bg-brand-500 px-3 text-theme-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {step.label}
        </button>
      )}
    </article>
  );
}
