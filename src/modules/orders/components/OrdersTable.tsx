import type { ReactNode } from "react";

import type { Pagination } from "../../../common/types/api";
import Pager from "../../../components/ui/pager";
import TableEmpty, { type Asked } from "../../../components/ui/table/TableEmpty";
import { nextStep } from "../orderFlow";
import type { OrderStatus, OwnerOrder } from "../services/ordersService";
import { OrderRow, ORDER_COLUMNS } from "./OrderRow";

/**
 * ORDERS AS A TABLE — the finished ones, and the ones from other days.
 *
 * A TABLE, not a wall of cards. The first version of this screen drew every
 * item, the address, the notes, the rider picker and both buttons for every
 * order. Four orders filled a laptop; a shop looking back over a month has
 * hundreds. The row carries what is needed to CHOOSE; a click opens the rest.
 *
 * Drawn twice on the Orders page — under the board for what was finished
 * today, and on its own for the past — so it is one component: two copies of
 * nine columns are two places that can disagree about the ninth.
 */
export function OrdersTable({ from, rows, loading, placed, empty, pagination, onPage, money, busy, onOpen, onAdvance }: {
  /** The question the rows came from — so a list that FAILED says so, not "nothing". */
  from: Asked;
  rows: OwnerOrder[];
  loading: boolean;
  placed: "time" | "moment";
  /** What to say when there is truly nothing. */
  empty: ReactNode;
  pagination: Pagination | undefined;
  onPage: (page: number) => void;
  money: (n: string | number) => string;
  busy: boolean;
  onOpen: (order: OwnerOrder) => void;
  onAdvance: (order: OwnerOrder, to: OrderStatus) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="overflow-x-auto">
        {/* NO `min-w` — the columns step down instead.
            A nine-column table on a 390px phone is not a table that needs
            scrolling sideways, it is a table with columns that have not
            earned their place there. Below `sm` it is not laid out as a table
            at all: each order is two columns (see OrderRow), the headings are
            not drawn, and the next-step button is in the detail panel a tap
            away.
            The steps are `sm` and `xl`, not `sm` and `md`, because the rail
            takes 290px from `lg` up: a 1024px tablet has 734px of page, which
            is less than a 768px phone-in-landscape has. The breakpoint asks
            the VIEWPORT, so the useful width is always the viewport minus
            whatever the rail is holding. */}
        <table role="table" className="block w-full text-left sm:table">
          <thead role="rowgroup" className="hidden sm:table-header-group">
            <tr role="row" className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
              <th role="columnheader" className="px-4 py-3 font-medium">Order</th>
              <th role="columnheader" className="px-4 py-3 font-medium">Placed</th>
              <th role="columnheader" className="px-4 py-3 font-medium">Customer</th>
              <th role="columnheader" className="px-4 py-3 font-medium">Items</th>
              <th role="columnheader" className="hidden px-4 py-3 font-medium xl:table-cell">How</th>
              <th role="columnheader" className="hidden px-4 py-3 font-medium xl:table-cell">Payment</th>
              <th role="columnheader" className="px-4 py-3 text-right font-medium">Total</th>
              <th role="columnheader" className="px-4 py-3 font-medium">Stage</th>
              <th role="columnheader" className="px-4 py-3 text-right font-medium">
                <span className="sr-only">Next step</span>
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="block divide-y divide-gray-100 sm:table-row-group dark:divide-gray-800">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} role="row" className="block sm:table-row">
                  <td role="cell" colSpan={ORDER_COLUMNS} className="block px-4 py-4 sm:table-cell">
                    <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr role="row" className="block sm:table-row">
                <TableEmpty from={from} what="the orders" colSpan={ORDER_COLUMNS} className="block px-4 py-12 text-center sm:table-cell">
                  {empty}
                </TableEmpty>
              </tr>
            ) : (
              rows.map((o) => {
                const step = nextStep(o);

                return (
                  <OrderRow
                    key={o.id}
                    order={o}
                    money={money}
                    busy={busy}
                    placed={placed}
                    nextLabel={step?.label ?? null}
                    onOpen={() => onOpen(o)}
                    onAdvance={() => {
                      if (step !== null) onAdvance(o, step.status);
                    }}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pager pagination={pagination} onPage={onPage} noun="orders" />
    </div>
  );
}
