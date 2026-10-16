import { Link } from "react-router";
import { timeOf } from "../../../common/format/date";
import { useMoney } from "../../shop/hooks/useShop";
import { methodWords } from "../khata";

export interface KhataCollections {
  total: number;
  count: number;
  by_method: Array<{ method: string; total: number; count: number }>;
  /** The day's own payments (Day & banking); a period's report sends none. */
  entries?: Array<{
    id: string;
    amount: number;
    method: string;
    reference: string | null;
    at: string | null;
    customer: { id: string; name: string; phone: string | null } | null;
    taken_by: string | null;
  }>;
}

/**
 * MONEY PAID AGAINST KHATA — beside the sales, never in them (L14).
 *
 * A credit sale was counted on the day it was rung. A transfer or a card paid
 * against it later reached no screen at all; a cash one only the drawer. This
 * says what came in, how, and from whom — and says out loud that it is not a
 * sale, so nobody adds it to one.
 */
export default function CollectedOnKhata({ collections, cashInDrawers = false }: { collections: KhataCollections; cashInDrawers?: boolean }) {
  const money = useMoney();
  if (collections.count === 0) return null;

  return (
    <section className="rounded-2xl border border-success-200 bg-success-50/40 p-5 dark:border-success-500/20 dark:bg-success-500/[0.04]" data-testid="khata-collected">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-white/90">Collected on khata</h3>
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">
            Paid against earlier credit sales — not sales, so not added to them.
            {cashInDrawers ? " The cash is already in the drawers above." : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular-nums text-success-700 dark:text-success-400">{money(collections.total)}</div>
          <div className="text-theme-xs text-gray-400">{collections.count} payment{collections.count === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {collections.by_method.map((m) => (
          <span key={m.method} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-theme-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {methodWords(m.method)} <span className="font-semibold tabular-nums">{money(m.total)}</span>
            <span className="text-gray-400"> · {m.count}</span>
          </span>
        ))}
      </div>

      {(collections.entries?.length ?? 0) > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-theme-sm">
            <thead>
              <tr className="text-left text-theme-xs uppercase tracking-wide text-gray-400">
                <th className="py-1.5 pr-3 font-medium">Customer</th>
                <th className="py-1.5 pr-3 font-medium">How</th>
                <th className="py-1.5 pr-3 font-medium">Time</th>
                <th className="py-1.5 pr-3 font-medium">Taken by</th>
                <th className="py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {collections.entries!.map((e) => (
                <tr key={e.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-2 pr-3">
                    {e.customer ? (
                      <Link to={`/tenant/customers?q=${encodeURIComponent(e.customer.phone ?? e.customer.name)}`} className="text-brand-500 hover:text-brand-600">
                        {e.customer.name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">{methodWords(e.method)}{e.reference ? ` · ${e.reference}` : ""}</td>
                  <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{e.at ? timeOf(e.at) : "—"}</td>
                  <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{e.taken_by ?? "—"}</td>
                  <td className="py-2 text-right font-medium tabular-nums text-gray-800 dark:text-white/90">{money(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
