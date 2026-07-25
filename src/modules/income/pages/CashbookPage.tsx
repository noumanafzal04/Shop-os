import { useState } from "react";
import { useMoney } from "../../shop/hooks/useShop";
import PageMeta from "../../../components/common/PageMeta";
import { useCashbook } from "../hooks/useIncome";

const PERIODS = [
  { value: "daily", label: "Today" },
  { value: "weekly", label: "This week" },
  { value: "monthly", label: "This month" },
  { value: "yearly", label: "This year" },
] as const;

export default function CashbookPage() {
  const money = useMoney();
  const [period, setPeriod] = useState<string>("monthly");
  const cashbook = useCashbook({ period });
  const data = cashbook.data;

  const totals = data?.totals;

  return (
    <>
      <PageMeta title="Cashbook | ShopOS" description="Money in and out" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Cashbook</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Everything in and out — sales and other income against expenses and refunds. Sales are
            counted automatically; you don't enter them here.
          </p>
          <p className="mt-1 text-theme-xs text-gray-400">
            This is money <span className="font-medium">booked</span> across all payment types (cash, card, credit) — not
            the cash drawer. For physical cash at the counter, use the POS shift close.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-gray-200 p-1 dark:border-gray-800">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`rounded-md px-3 py-1.5 text-theme-sm font-medium transition-colors ${
                period === p.value
                  ? "bg-brand-500 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card label="Money in" value={money(totals?.money_in ?? 0)} tone="in"
          sub={`Sales ${money(totals?.sales_revenue ?? 0)} · Other ${money(totals?.other_income ?? 0)}`} />
        <Card label="Money out" value={money(totals?.money_out ?? 0)} tone="out"
          sub={`Expenses ${money(totals?.expenses ?? 0)} · Refunds ${money(totals?.refunds ?? 0)}`} />
        <Card label="Net this period" value={money(totals?.net ?? 0)} tone={(totals?.net ?? 0) >= 0 ? "in" : "out"} />
        <Card label="Cumulative net" value={money(data?.closing_balance ?? 0)} tone="neutral"
          sub={`Since opening · was ${money(data?.opening_balance ?? 0)} before this period`} />
      </div>

      {/* Day-by-day ledger */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-6 py-3 font-medium">Date</th>
                <th className="px-6 py-3 font-medium text-right">Sales</th>
                <th className="px-6 py-3 font-medium text-right">Other income</th>
                <th className="px-6 py-3 font-medium text-right">Expenses</th>
                <th className="px-6 py-3 font-medium text-right">Refunds</th>
                <th className="px-6 py-3 font-medium text-right">Net</th>
                <th className="px-6 py-3 font-medium text-right">Running net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {cashbook.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-6 py-4">
                      <div className="h-6 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : (data?.days ?? []).every((d) => d.money_in === 0 && d.money_out === 0) ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    No money movement in this period yet.
                  </td>
                </tr>
              ) : (
                (data?.days ?? [])
                  .filter((d) => d.money_in !== 0 || d.money_out !== 0)
                  .map((d) => (
                    <tr key={d.date} className="text-theme-sm text-gray-700 dark:text-gray-300">
                      <td className="px-6 py-4 font-medium text-gray-800 dark:text-white/90">{d.date}</td>
                      <td className="px-6 py-4 text-right">{d.sales_revenue ? money(d.sales_revenue) : "—"}</td>
                      <td className="px-6 py-4 text-right">{d.other_income ? money(d.other_income) : "—"}</td>
                      <td className="px-6 py-4 text-right">{d.expenses ? money(d.expenses) : "—"}</td>
                      <td className="px-6 py-4 text-right">{d.refunds ? money(d.refunds) : "—"}</td>
                      <td className={`px-6 py-4 text-right font-medium ${d.net >= 0 ? "text-success-600 dark:text-success-500" : "text-error-500"}`}>
                        {money(d.net)}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-gray-800 dark:text-white/90">{money(d.balance)}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "in" | "out" | "neutral" }) {
  const color =
    tone === "in" ? "text-success-600 dark:text-success-500"
    : tone === "out" ? "text-error-500"
    : "text-gray-800 dark:text-white/90";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-1 text-theme-xs text-gray-400">{sub}</p>}
    </div>
  );
}
