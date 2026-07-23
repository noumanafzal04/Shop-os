import { useState } from "react";
import PageMeta from "../../../components/common/PageMeta";
import Button from "../../../components/ui/button/Button";
import Badge from "../../../components/ui/badge/Badge";
import { MetricCard, MetricCardSkeleton } from "../../../common/ui/MetricCard";
import { useBillingSummary, usePayments } from "../hooks/useAdmin";

const money = (n: string | number) => `Rs ${Number(n).toLocaleString()}`;

export default function AdminPaymentsPage() {
  const [page, setPage] = useState(1);
  const summary = useBillingSummary();
  const payments = usePayments({ page });

  const s = summary.data;
  const rows = payments.data?.data ?? [];
  const pagination = payments.data?.meta.pagination;

  return (
    <>
      <PageMeta title="Billing | ShopOS Admin" description="Subscription payments" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Billing & Payments</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Subscription revenue and payment history</p>
      </div>

      {/* Revenue + subscription health */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3 md:gap-6">
        {summary.isLoading || !s ? (
          <><MetricCardSkeleton /><MetricCardSkeleton /><MetricCardSkeleton /></>
        ) : (
          <>
            <MetricCard label="Revenue — This Month" value={money(s.revenue.this_month)} />
            <MetricCard label="Revenue — This Year" value={money(s.revenue.this_year)} />
            <MetricCard label="Revenue — All Time" value={money(s.revenue.all_time)} />
          </>
        )}
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 md:gap-6">
        {summary.isLoading || !s ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : (
          <>
            <MetricCard label="Active" value={s.subscriptions.active} />
            <MetricCard label="Expiring ≤7d" value={s.subscriptions.expiring_soon} hint="needs renewal soon" />
            <MetricCard label="Expired" value={s.subscriptions.expired} />
            <MetricCard label="Suspended" value={s.subscriptions.suspended} />
          </>
        )}
      </div>

      {/* Payment ledger */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h3 className="font-semibold text-gray-800 dark:text-white/90">All Payments</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Paid</th>
                <th className="px-6 py-3 font-medium">Business</th>
                <th className="px-6 py-3 font-medium">Plan</th>
                <th className="px-6 py-3 font-medium">Period</th>
                <th className="px-6 py-3 font-medium">Method</th>
                <th className="px-6 py-3 font-medium">Reference</th>
                <th className="px-6 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {payments.isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-6 py-4"><div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">No payments recorded yet.</td></tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4">{new Date(p.paid_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 font-medium text-gray-800 dark:text-white/90">{p.tenant.business_name}</td>
                    <td className="px-6 py-4">{p.plan_name}</td>
                    <td className="px-6 py-4 text-theme-xs text-gray-400">{p.period_start} → {p.period_end}</td>
                    <td className="px-6 py-4"><Badge size="sm" color="light">{p.method.replace("_", " ")}</Badge></td>
                    <td className="px-6 py-4 text-theme-xs">{p.reference ?? "—"}</td>
                    <td className="px-6 py-4 text-right font-medium">{money(p.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3 text-sm dark:border-gray-800">
            <span className="text-gray-500 dark:text-gray-400">{pagination.total} payments · page {pagination.current_page} of {pagination.last_page}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pagination.current_page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={pagination.current_page >= pagination.last_page} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
