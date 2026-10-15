import { useMoney } from "../../shop/hooks/useShop";
import { shopDate } from "../../../common/format/date";
import { dueOn, paidBeforeHistory, payMethodLabel, paymentLines } from "../payMath";
import type { PurchaseOrder } from "../types";

/**
 * WHAT THIS ORDER COST, WHAT WAS PAID, WHEN AND HOW, AND WHAT IS LEFT.
 *
 * The order said "Paid 1,000 · partial" and its total, and nothing else: a
 * part payment's date, amount and method were on no screen (the user,
 * 2026-10-15). The bill is what ARRIVED — the server bills on delivery — so
 * "left to pay" is the same figure the Pay sheet offers.
 */
export function OrderPayments({ order }: { order: PurchaseOrder }) {
  const money = useMoney();
  const history = paymentLines(order);
  const earlier = paidBeforeHistory(order);
  const arrived = Number(order.received_total ?? 0);
  const left = Math.max(0, dueOn(order));

  return (
    <div data-testid="order-payments" className="mb-4 rounded-xl border border-gray-200 dark:border-gray-800">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-t-xl bg-gray-100 text-sm sm:grid-cols-4 dark:bg-gray-800">
        {[
          ["Ordered", money(order.total ?? 0), ""],
          ["Arrived — the bill", money(arrived), ""],
          ["Paid", money(order.amount_paid ?? 0), "text-success-600 dark:text-success-500"],
          ["Left to pay", money(left), left > 0 ? "text-error-600 dark:text-error-400" : "text-gray-800 dark:text-white/90"],
        ].map(([label, value, tone]) => (
          <div key={label} className="bg-white px-4 py-3 dark:bg-gray-900">
            <dt className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className={`mt-0.5 font-semibold tabular-nums ${tone || "text-gray-800 dark:text-white/90"}`}>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="px-4 py-3">
        <p className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">Payments</p>
        {history.length === 0 && earlier === 0 ? (
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">
            {arrived > 0 ? "Nothing paid on this order yet." : "Nothing has arrived yet, so nothing is owed."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 text-theme-sm dark:divide-gray-800">
            {history.map((l) => (
              <li key={l.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
                <span className="text-gray-700 dark:text-gray-300">
                  {shopDate(l.paidAt)} · {payMethodLabel(l.method)}
                  {l.reference && <span className="text-gray-400"> · {l.reference}</span>}
                  {l.amount < l.whole - 0.005 && <span className="text-gray-400"> · part of a {money(l.whole)} payment</span>}
                </span>
                <span className="font-medium tabular-nums text-gray-800 dark:text-white/90">{money(l.amount)}</span>
              </li>
            ))}
            {earlier > 0 && (
              <li className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                <span className="text-gray-500 dark:text-gray-400">Paid on account earlier (before payments were itemised)</span>
                <span className="font-medium tabular-nums text-gray-800 dark:text-white/90">{money(earlier)}</span>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
