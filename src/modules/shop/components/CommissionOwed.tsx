import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../../../common/api/client";
import Badge from "../../../components/ui/badge/Badge";

/**
 * WHAT THIS SHOP OWES THE MARKETPLACE.
 *
 * ── Why it is on the Subscription page and not its own ───────────────
 *
 * Because a shop owner asking "what do I pay CartZe" is asking one question,
 * and the answer is two numbers. Splitting them across two screens is how a
 * shop concludes it has been charged twice for the same thing.
 *
 * They are still shown APART, though, and labelled apart: the plan is what
 * this business pays for the software every month, and this is a share of what
 * the marketplace actually sold for it. A shop that cannot tell them apart
 * cannot check either.
 *
 * ── And why the orders are listed ────────────────────────────────────
 *
 * A bill nobody can check is a bill nobody trusts. A total on its own has to
 * be taken on faith; the orders behind it can be argued with one at a time,
 * which is the difference between an invoice and a demand.
 *
 * Absent entirely when the platform charges this shop nothing — an empty card
 * saying "Rs 0" invites a question that has no subject.
 */

type Owed = {
  rate: number;
  rate_is_yours: boolean;
  outstanding: { orders: number; base: number; amount: number };
  charges: Array<{
    order_number: string | null;
    rate_percent: number;
    base_amount: number;
    amount: number;
    charged_at: string | null;
  }>;
  invoices: Array<{
    number: string;
    period_start: string | null;
    period_end: string | null;
    orders_count: number;
    amount: number;
    status: "unpaid" | "paid" | "void";
  }>;
};

const money = (n: number) => `Rs ${Number(n).toLocaleString()}`;

export function CommissionOwed() {
  const owed = useQuery({
    queryKey: ["shop", "commission"],
    queryFn: async () => (await apiGet<Owed>("/commission")).data,
    // A shop without `settings.manage` gets a 403 here, and that is not an
    // error worth a red box on a page about something else.
    retry: false,
  });

  const d = owed.data;

  // Nothing charged, nothing billed, nothing to explain.
  if (d == null || (d.rate === 0 && d.outstanding.orders === 0 && d.invoices.length === 0)) {
    return null;
  }

  return (
    <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Marketplace commission
          </h3>
          <p className="mt-0.5 text-theme-sm text-gray-500 dark:text-gray-400">
            {d.rate}% of the goods on each completed online order
            {d.rate_is_yours ? " — a rate agreed for your shop" : ""}. Separate from your plan
            above, which is what you pay for the software.
          </p>
        </div>
        {d.outstanding.amount > 0 && (
          <div className="text-right">
            <div className="text-xl font-semibold text-gray-800 dark:text-white/90">
              {money(d.outstanding.amount)}
            </div>
            <div className="text-theme-xs text-gray-500 dark:text-gray-400">
              not yet invoiced · {d.outstanding.orders} order
              {d.outstanding.orders === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>

      {d.invoices.length > 0 && (
        <div className="mb-4 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {d.invoices.map((inv) => (
            <div key={inv.number} className="flex flex-wrap items-center gap-3 px-4 py-3 text-theme-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-800 dark:text-white/90">{inv.number}</div>
                <div className="text-theme-xs text-gray-400">
                  {inv.period_start} → {inv.period_end} · {inv.orders_count} orders
                </div>
              </div>
              <span className="font-medium text-gray-800 dark:text-white/90">{money(inv.amount)}</span>
              <Badge
                color={inv.status === "paid" ? "success" : inv.status === "void" ? "light" : "warning"}
              >
                {inv.status === "void" ? "withdrawn" : inv.status}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {d.charges.length > 0 && (
        <details className="text-theme-sm">
          <summary className="cursor-pointer text-gray-600 dark:text-gray-300">
            The orders behind the outstanding amount
          </summary>
          <div className="mt-2 max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {d.charges.map((ch, i) => (
              <div key={`${ch.order_number}-${i}`} className="flex items-center gap-3 px-4 py-2">
                <span className="flex-1 text-gray-700 dark:text-gray-300">{ch.order_number}</span>
                <span className="text-theme-xs text-gray-400">
                  {money(ch.base_amount)} × {ch.rate_percent}%
                </span>
                <span className="w-20 text-right font-medium text-gray-800 dark:text-white/90">
                  {money(ch.amount)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
