import { useMoney } from "../../shop/hooks/useShop";
import { shopDate } from "../../../common/format/date";
import { useSupplier } from "../hooks/usePurchases";
import { dueOn, payMethodLabel } from "../payMath";

/**
 * A SUPPLIER'S ACCOUNT: EVERY PAYMENT — WHEN, HOW MUCH, HOW, AND FOR WHICH
 * ORDERS — AND EVERY ORDER WITH WHAT IS LEFT ON IT.
 *
 * The Suppliers screen showed one figure, what is owed. A part payment made
 * last week was on no screen at all (the user, 2026-10-15: "uski history kb
 * kitne pay kiye thy or kaise — koi record ni").
 */
export function SupplierHistory({ supplierId }: { supplierId: string }) {
  const money = useMoney();
  const detail = useSupplier(supplierId);
  const s = detail.data;

  if (detail.isLoading) return <div className="h-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />;
  if (!s) return <p className="text-theme-sm text-error-600">The supplier's account could not be loaded.</p>;

  const payments = s.payments ?? [];
  const orders = s.purchase_orders ?? [];

  return (
    <div data-testid="supplier-history" className="space-y-5">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {(s.outstanding ?? 0) > 0 ? <>You owe <span className="font-semibold text-error-500">{money(s.outstanding ?? 0)}</span></>
          : (s.advance ?? 0) > 0 ? <>Paid ahead: <span className="font-semibold text-brand-500">{money(s.advance ?? 0)}</span></>
          : "Nothing owed."}
      </p>

      <section>
        <h4 className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">Payments{payments.length === 20 ? " — the latest 20" : ""}</h4>
        {payments.length === 0 ? (
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">No payments yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full min-w-[30rem] text-left text-theme-sm">
              <thead className="bg-gray-50 text-theme-xs uppercase text-gray-400 dark:bg-white/5">
                <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">How</th><th className="px-3 py-2">For</th><th className="px-3 py-2 text-right">Amount</th></tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const parts = p.allocations ?? [];
                  const spread = parts.reduce((sum, a) => sum + Number(a.amount), 0);
                  const ahead = Math.round((Number(p.amount) - spread) * 100) / 100;
                  return (
                    <tr key={p.id} className="border-t border-gray-100 align-top dark:border-gray-800">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700 dark:text-gray-300">{shopDate(p.paid_at)}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                        {payMethodLabel(p.method)}
                        {p.reference && <span className="block text-theme-xs text-gray-400">{p.reference}</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                        {parts.length > 0 ? (
                          <>
                            {parts.map((a) => (
                              <span key={a.id} className="block">{a.purchase_order?.po_number ?? "An order"} · {money(a.amount)}</span>
                            ))}
                            {ahead > 0.005 && <span className="block text-brand-500">Paid ahead · {money(ahead)}</span>}
                          </>
                        ) : (
                          // Before payments said what they paid: the order it
                          // named, which it was applied to whole — or "on
                          // account", spread oldest-first then or kept ahead.
                          p.purchase_order?.po_number ?? "On account"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-800 dark:text-white/90">{money(p.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">Orders{orders.length === 20 ? " — the latest 20" : ""}</h4>
        {orders.length === 0 ? (
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full min-w-[30rem] text-left text-theme-sm">
              <thead className="bg-gray-50 text-theme-xs uppercase text-gray-400 dark:bg-white/5">
                <tr><th className="px-3 py-2">Order</th><th className="px-3 py-2 text-right">Bill</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Left</th></tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                      {o.po_number}
                      <span className="block text-theme-xs text-gray-400">{shopDate(o.order_date)} · {o.status.replace(/_/g, " ")}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(o.received_total ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(o.amount_paid ?? 0)}</td>
                    <td className={`px-3 py-2 text-right font-medium tabular-nums ${dueOn(o) > 0 ? "text-error-600 dark:text-error-400" : "text-gray-500"}`}>{money(Math.max(0, dueOn(o)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
