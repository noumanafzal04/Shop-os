import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import PageMeta from "../../../components/common/PageMeta";
import Badge from "../../../components/ui/badge/Badge";
import Pager from "../../../components/ui/pager";
import { downloadFile } from "../../../common/api/download";
import { MoneyFilterBar } from "../../expenses/components/MoneyFilterBar";
import { useExpenseCategories } from "../../expenses/hooks/useExpenses";
import {
  activeFilterCount,
  monthRange,
  toParams,
  type MoneyFilters,
} from "../../expenses/services/moneyFilters";
import { useMoney } from "../../shop/hooks/useShop";
import { useIncomeCategories, useLedger } from "../hooks/useIncome";
import { LEDGER_TYPES, type LedgerFilters, type LedgerType } from "../services/ledgerService";
import { formatEntryDate } from "../../../components/ui/filters";

const TYPE_FILTERS: Array<{ value: LedgerType; label: string }> = [
  { value: "sale", label: "Sales" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expenses" },
  { value: "refund", label: "Refunds" },
  // The fifth money source. Paying the wholesaler is not an expense — a shop
  // that files the wholesaler's bill AND records the payment would double-count
  // it — so it is its own row type, and needs its own filter.
  { value: "supplier_payment", label: "Supplier paid" },
];

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "credit", label: "Credit" },
  { value: "other", label: "Other" },
];

/**
 * The ledger.
 *
 * The Cashbook says what each day came to; this says what each day was MADE
 * of. For a shop that is a drill-down. For a books-only business it is the
 * product — their whole job is checking the lines, and a day that reads
 * "Rs 41,200 out" with no way to open it is an answer nobody can verify.
 *
 * Three things the page must get right:
 *
 *   The balance column is a BALANCE. It opens at whatever the account stood at
 *   before the period, not at zero, and it carries across pages.
 *
 *   Filtering is a VIEW, not a different account — narrowing to one category
 *   never rewrites the opening figure. The server holds that line; the header
 *   says so out loud, because a running balance under a filter looks wrong
 *   until you know what it means.
 *
 *   Money in and money out are separate columns, the way every cash book that
 *   has ever existed prints them. One signed column saves a column and costs
 *   the reader a minus sign to hunt for on every row.
 */
export default function LedgerPage() {
  const money = useMoney();
  const [params] = useSearchParams();

  // Arriving from a cashbook day opens on that day; otherwise this month.
  const day = params.get("date");
  const [filters, setFilters] = useState<LedgerFilters>(() => ({
    ...(day ? { from: day, to: day } : monthRange()),
    page: 1,
  }));

  const expenseCategories = useExpenseCategories();
  const incomeCategories = useIncomeCategories();
  const ledger = useLedger(filters);

  const rows = ledger.data?.data ?? [];
  const meta = ledger.data?.meta;
  const pagination = meta?.pagination;
  const page = filters.page ?? 1;

  const categories = [
    ...(expenseCategories.data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name })),
    ...(incomeCategories.data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name })),
  ];

  const toggleType = (value: LedgerType) => {
    const current = filters.type ?? [];
    setFilters({
      ...filters,
      type: current.includes(value) ? current.filter((t) => t !== value) : [...current, value],
      page: 1,
    });
  };

  return (
    <>
      <PageMeta title="Ledger | CartZe" description="Every movement of money, with a running balance" />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Ledger</h2>
          <p className="max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Every movement of money, in the order it happened, with the balance carried down. Sales
            and refunds are counted automatically — you never enter them here.
          </p>
          <p className="mt-1 text-theme-xs text-gray-400">
            The opening balance is what the account stood at before this period. Filtering changes
            what you can see, never what the account was worth.
          </p>
        </div>
        <Link
          to="/tenant/cashbook"
          className="rounded-lg border border-gray-300 px-3 py-2 text-theme-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          Day summary
        </Link>
      </div>

      {/* Opening → in → out → closing, in the order the sentence is read. */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Figure label="Opening balance" value={money(meta?.opening ?? 0)} />
        <Figure label="Money in" value={money(meta?.totals.in ?? 0)} tone="success" />
        <Figure label="Money out" value={money(meta?.totals.out ?? 0)} tone="error" />
        <Figure label="Closing balance" value={money(meta?.closing ?? 0)} strong />
      </div>

      {/* Type is the ledger's own axis — everything else is the shared bar. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((t) => {
          const on = (filters.type ?? []).includes(t.value);

          return (
            <button
              key={t.value}
              type="button"
              onClick={() => toggleType(t.value)}
              aria-pressed={on}
              className={`rounded-full border px-3 py-1.5 text-theme-xs font-medium transition-colors ${
                on
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-gray-300 text-gray-600 hover:border-brand-300 hover:text-brand-600 dark:border-gray-700 dark:text-gray-300"
              }`}
            >
              {t.label}
            </button>
          );
        })}
        {(filters.type ?? []).length > 0 && (
          <button
            type="button"
            onClick={() => setFilters({ ...filters, type: [], page: 1 })}
            className="text-theme-xs text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
          >
            All types
          </button>
        )}
      </div>

      <MoneyFilterBar
        filters={filters as MoneyFilters}
        onChange={(next) => setFilters({ ...filters, ...next })}
        categories={categories}
        methods={METHODS}
        money={money}
        searchPlaceholder="Search description, invoice or bill number…"
        action={
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/ledger/export",
                {
                  ...toParams(filters),
                  period: "custom",
                  ...(filters.type?.length ? { type: filters.type.join(",") } : {}),
                  ...(filters.direction ? { direction: filters.direction } : {}),
                },
                "ledger.csv",
              )
            }
            className="rounded-lg border border-gray-300 px-3 py-2.5 text-theme-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Export
          </button>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left">
            <thead>
              <tr className="border-b border-gray-200 text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Entry</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">Method</th>
                <th className="px-5 py-3 text-right font-medium">In</th>
                <th className="px-5 py-3 text-right font-medium">Out</th>
                <th className="px-5 py-3 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {/* The balance a page starts from, so page three does not look
                  like it began the month at Rs 91,000. */}
              {rows.length > 0 && (
                <tr className="bg-gray-50 text-theme-xs text-gray-500 dark:bg-white/[0.02] dark:text-gray-400">
                  <td className="px-5 py-2" colSpan={6}>
                    {page > 1 ? "Balance brought forward" : "Opening balance"}
                  </td>
                  <td className="px-5 py-2 text-right font-medium tabular-nums">
                    {money(rows[0].balance - rows[0].in + rows[0].out)}
                  </td>
                </tr>
              )}

              {ledger.isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-5 py-4">
                      <div className="h-5 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    {activeFilterCount(filters) > 0 || (filters.type ?? []).length > 0
                      ? "Nothing matches these filters."
                      : "Nothing moved in this period."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`${row.type}-${row.id}`} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums">{formatEntryDate(row.date)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Badge size="sm" color={badgeColor(row.type)}>{LEDGER_TYPES[row.type].label}</Badge>
                        <span className="font-medium text-gray-800 dark:text-white/90">
                          {row.description || "—"}
                        </span>
                      </div>
                      {row.reference && (
                        <span className="mt-0.5 block text-theme-xs text-gray-400">{row.reference}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">{row.category ?? "—"}</td>
                    <td className="px-5 py-3 capitalize">{(row.method ?? "—").replace(/_/g, " ")}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-success-600 dark:text-success-500">
                      {row.in ? money(row.in) : ""}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-error-600 dark:text-error-500">
                      {row.out ? money(row.out) : ""}
                    </td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums text-gray-800 dark:text-white/90">
                      {money(row.balance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pager
            pagination={pagination}
            onPage={(next) => setFilters({ ...filters, page: next })}
            noun="entries"
          />
      </div>
    </>
  );
}

function badgeColor(type: LedgerType): "success" | "error" | "primary" | "light" {
  const tone = LEDGER_TYPES[type].tone;

  return tone === "success" ? "success" : tone === "error" ? "error" : tone === "brand" ? "primary" : "light";
}

function Figure({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: "success" | "error";
  strong?: boolean;
}) {
  const colour = tone === "success"
    ? "text-success-600 dark:text-success-500"
    : tone === "error"
      ? "text-error-600 dark:text-error-500"
      : "text-gray-800 dark:text-white/90";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className={`${strong ? "text-2xl" : "text-xl"} font-bold tabular-nums ${colour}`}>{value}</p>
      <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}
