import { useMemo, useState } from "react";
import { Link } from "react-router";

import { downloadCsv } from "../../../common/api/download";
import PageMeta from "../../../components/common/PageMeta";
import Badge from "../../../components/ui/badge/Badge";
import { DateRangeFilter, FilterBar, FilterSelect, type DateRange } from "../../../components/ui/filters";
import Pager from "../../../components/ui/pager";
import { Panel, PanelEmpty } from "../../dashboard/components/admin/Panel";
import { RevenueTrendPanel } from "../../dashboard/components/admin/RevenueTrendPanel";
import { money } from "../../dashboard/components/admin/format";
import { useBillingSummary, usePayments } from "../hooks/useAdmin";
import type { ChaseRow, MethodSplit, OutstandingBucket, PaymentTotals } from "../services/adminService";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

/**
 * BILLING & PAYMENTS — a screen that can now say how much.
 *
 * ── What it used to be ─────────────────────────────────────────────────
 *
 * Seven numbers and a table. Three of the numbers were revenue totals, four
 * were HEADCOUNTS — active, expiring, expired, suspended — and the table had
 * no filters at all, though the endpoint under it had accepted three since the
 * day it was written.
 *
 * Nobody chasing subscriptions is chasing heads. "Eleven shops are overdue" and
 * "eleven shops are overdue for 143,000" are different mornings, and only one
 * of them tells you whether to spend it on the phone. And an admin asked "what
 * did this shop pay in June" was handed page one of everything.
 *
 * ── What it is now, in the order somebody reads it ─────────────────────
 *
 *   1. what came in           — the twelve-month trend, the same one the
 *                               platform dashboard draws, from the same method
 *   2. what has NOT come in   — money late, split by grace and overdue, with
 *                               the shops nobody has priced counted apart
 *   3. who to ring today      — names, how late, how much, and their number
 *   4. the ledger             — filterable, with the total of the FILTER
 *                               rather than of the page
 */
export default function AdminPaymentsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("");
  const [range, setRange] = useState<DateRange>({ from: null, to: null });

  const summary = useBillingSummary();
  const payments = usePayments({ search, method, from: range.from, to: range.to, page });

  const s = summary.data;
  const rows = payments.data?.data ?? [];
  const pagination = payments.data?.meta.pagination;
  const totals = payments.data?.meta.totals as PaymentTotals | undefined;
  const methods = (payments.data?.meta.methods ?? []) as MethodSplit[];

  const filtered = search !== "" || method !== "" || range.from !== null || range.to !== null;

  const reset = <T,>(setter: (value: T) => void, value: T) => () => {
    setter(value);
    setPage(1);
  };

  const applied = [
    method !== "" && {
      key: "method",
      label: "Paid by",
      value: METHODS.find((m) => m.value === method)?.label ?? method,
      onRemove: reset(setMethod, ""),
    },
    (range.from !== null || range.to !== null) && {
      key: "range",
      label: "Paid",
      value: [range.from, range.to].filter(Boolean).join(" → "),
      onRemove: reset(setRange, { from: null, to: null } as DateRange),
    },
  ].filter(Boolean) as Array<{ key: string; label: string; value: string; onRemove: () => void }>;

  /**
   * The CSV is built from the PAGE on screen, and says so on the button.
   *
   * The alternative would be a server export endpoint; until there is one,
   * quietly writing 20 rows into a file called "payments.csv" would be a
   * export that lies about its own scope — the worst kind, because it looks
   * complete when it is opened.
   */
  const exportPage = () => {
    downloadCsv(
      `payments-page-${page}.csv`,
      ["Paid", "Business", "Plan", "Period start", "Period end", "Method", "Reference", "Amount"],
      rows.map((p) => [
        new Date(p.paid_at).toLocaleDateString(),
        p.tenant?.business_name ?? "",
        p.plan_name,
        p.period_start,
        p.period_end,
        p.method,
        p.reference ?? "",
        Number(p.amount),
      ]),
    );
  };

  return (
    <>
      <PageMeta title="Billing | CartZe Admin" description="Subscription payments" />

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">Billing &amp; Payments</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          What came in, what has not, and who to ring about it
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3 md:gap-6">
        <div className="lg:col-span-2">
          <RevenueTrendPanel series={s?.revenue_series} loading={summary.isLoading} />
        </div>

        <div className="flex flex-col gap-4 md:gap-6">
          <RevenueSoFar summary={s} loading={summary.isLoading} />
          <MoneyLate outstanding={s?.outstanding} loading={summary.isLoading} />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2 md:gap-6">
        <ChaseList rows={s?.chase} loading={summary.isLoading} />
        <SubscriptionHealth subscriptions={s?.subscriptions} loading={summary.isLoading} />
      </div>

      <h3 className="mb-4 font-semibold text-gray-800 dark:text-white/90">The ledger</h3>

      <FilterBar
        search={{
          value: search,
          onChange: (value) => {
            setSearch(value);
            setPage(1);
          },
          placeholder: "Search a shop, plan or reference…",
          label: "Search payments",
        }}
        applied={applied}
        onClearAll={() => {
          setSearch("");
          setMethod("");
          setRange({ from: null, to: null });
          setPage(1);
        }}
        results={{ count: totals?.payments, noun: "payments", loading: payments.isLoading }}
        right={
          <button
            type="button"
            onClick={exportPage}
            disabled={rows.length === 0}
            className="h-11 rounded-xl border border-gray-200 px-4 text-theme-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Export this page
          </button>
        }
      >
        <DateRangeFilter
          label="Any date"
          value={range}
          onChange={(next) => {
            setRange(next);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Any method"
          value={method}
          onChange={(value) => {
            setMethod(value);
            setPage(1);
          }}
          options={METHODS}
        />
      </FilterBar>

      {/* What the filtered ledger is WORTH, and what it was paid with. The row
          count above answers "how many"; nobody opens a ledger to ask that. */}
      {totals !== undefined && totals.payments > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <span className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2 text-theme-sm font-semibold text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
            {money(totals.amount)}
            <span className="ml-1.5 font-normal opacity-70">
              {filtered ? "in this filter" : "all time"}
            </span>
          </span>
          {methods.map((split) => (
            <button
              key={split.method}
              type="button"
              onClick={() => {
                setMethod(split.method === method ? "" : split.method);
                setPage(1);
              }}
              aria-pressed={split.method === method}
              className={`rounded-xl border px-3.5 py-2 text-theme-sm transition ${
                split.method === method
                  ? "border-brand-400 bg-brand-50 font-semibold text-brand-700 dark:border-brand-500/50 dark:bg-brand-500/10 dark:text-brand-300"
                  : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-800 dark:text-gray-300"
              }`}
            >
              <span className="capitalize">{split.method.replace(/_/g, " ")}</span>
              <span className="ml-1.5 tabular-nums opacity-70">{money(split.amount)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
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
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
                    {filtered
                      // An empty table under a filter reads as "there is
                      // nothing here" unless it says otherwise.
                      ? "No payment matches these filters."
                      : "No payments recorded yet."}
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.id} className="text-theme-sm text-gray-700 dark:text-gray-300">
                    <td className="px-6 py-4">{new Date(p.paid_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 font-medium text-gray-800 dark:text-white/90">
                      {p.tenant?.business_name ?? (
                        // The relation is `withTrashed` now, so a closed shop
                        // keeps its name here. This is the belt-and-braces case:
                        // a row whose shop is gone for good should say so, not
                        // render an empty cell that reads as a bug.
                        <span className="text-gray-400">Shop no longer on record</span>
                      )}
                    </td>
                    <td className="px-6 py-4">{p.plan_name}</td>
                    <td className="px-6 py-4 text-theme-xs text-gray-400">{p.period_start} → {p.period_end}</td>
                    <td className="px-6 py-4"><Badge size="sm" color="light">{p.method.replace("_", " ")}</Badge></td>
                    <td className="px-6 py-4 text-theme-xs">{p.reference ?? "—"}</td>
                    <td className="px-6 py-4 text-right font-medium tabular-nums">{money(Number(p.amount))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pager pagination={pagination} onPage={setPage} noun="payments" />
      </div>
    </>
  );
}

/** What has come in — the month in full, the year and all time beneath it. */
function RevenueSoFar({
  summary,
  loading,
}: {
  summary: { revenue: { this_month: number; this_year: number; all_time: number } } | undefined;
  loading: boolean;
}) {
  return (
    <Panel title="Revenue">
      {loading || summary === undefined ? (
        <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      ) : (
        <>
          <p className="text-title-sm font-bold text-gray-800 dark:text-white/90">
            {money(summary.revenue.this_month)}
          </p>
          <p className="text-theme-xs text-gray-400">this month</p>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
            <Figure label="This year" value={money(summary.revenue.this_year)} />
            <Figure label="All time" value={money(summary.revenue.all_time)} />
          </div>
        </>
      )}
    </Panel>
  );
}

/**
 * MONEY THAT IS LATE — the number this screen never once said out loud.
 *
 * Grace and overdue are kept apart because they are different jobs, and shops
 * with no plan on them are counted apart from both: they owe nothing, and
 * folding them into a total as zeroes would hide the one list worth having —
 * businesses nobody has priced yet.
 */
function MoneyLate({
  outstanding,
  loading,
}: {
  outstanding: { unpaid: OutstandingBucket; grace: OutstandingBucket; suspended: OutstandingBucket } | undefined;
  loading: boolean;
}) {
  const unpriced = useMemo(
    () =>
      outstanding === undefined
        ? 0
        : outstanding.unpaid.unpriced + outstanding.grace.unpriced + outstanding.suspended.unpriced,
    [outstanding],
  );

  return (
    <Panel title="Money late">
      {loading || outstanding === undefined ? (
        <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      ) : (
        <>
          <p className="text-title-sm font-bold text-error-600 dark:text-error-400">
            {money(outstanding.unpaid.amount + outstanding.grace.amount)}
          </p>
          <p className="text-theme-xs text-gray-400">
            across {outstanding.unpaid.shops + outstanding.grace.shops} shops
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
            <Figure
              label={`Overdue · ${outstanding.unpaid.shops}`}
              value={money(outstanding.unpaid.amount)}
            />
            <Figure
              label={`In grace · ${outstanding.grace.shops}`}
              value={money(outstanding.grace.amount)}
            />
          </div>
          {unpriced > 0 && (
            <Link
              to="/admin/tenants?plan_id=none"
              className="mt-3 block rounded-xl bg-warning-50 px-3 py-2 text-theme-xs font-medium text-warning-700 transition hover:bg-warning-100 dark:bg-warning-500/10 dark:text-warning-400"
            >
              {unpriced} {unpriced === 1 ? "shop has" : "shops have"} no plan on them yet →
            </Link>
          )}
        </>
      )}
    </Panel>
  );
}

/** Who to ring today: in grace first, longest wait first. */
function ChaseList({ rows, loading }: { rows: ChaseRow[] | undefined; loading: boolean }) {
  return (
    <Panel title="Chase today" subtitle="In grace first — one call away from paying">
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : (rows ?? []).length === 0 ? (
        <PanelEmpty>Nobody is behind. Every shop is inside its subscription.</PanelEmpty>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {(rows ?? []).map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <Link
                  to={`/admin/tenants/${row.id}`}
                  className="block truncate text-theme-sm font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400"
                >
                  {row.business_name}
                </Link>
                <p className="truncate text-theme-xs text-gray-400">
                  {row.plan_name ?? "no plan"}
                  {row.phone ? ` · ${row.phone}` : ""}
                </p>
              </div>

              <Badge size="sm" color={row.payment_status === "grace" ? "warning" : "error"}>
                {/* Worked out on the server, so this screen and the tenant
                    list can never disagree about how late somebody is. */}
                {row.days_late === null ? row.payment_status : `${row.days_late}d late`}
              </Badge>

              <span className="w-24 shrink-0 text-right text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
                {row.amount === null ? <span className="text-gray-400">—</span> : money(row.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The four buckets as one bar rather than four cards.
 *
 * They partition the platform — the server asserts it, BillingTest asserts it —
 * so drawing them as a proportion says something four separate numbers cannot:
 * how much of the platform is in each state.
 */
function SubscriptionHealth({
  subscriptions,
  loading,
}: {
  subscriptions: { active: number; expiring_soon: number; expired: number; suspended: number } | undefined;
  loading: boolean;
}) {
  const bands = [
    { key: "active", label: "Active", value: subscriptions?.active ?? 0, bar: "bg-success-500", dot: "bg-success-500" },
    { key: "expiring_soon", label: "Expiring ≤7d", value: subscriptions?.expiring_soon ?? 0, bar: "bg-warning-400", dot: "bg-warning-400" },
    { key: "expired", label: "Expired", value: subscriptions?.expired ?? 0, bar: "bg-error-500", dot: "bg-error-500" },
    { key: "suspended", label: "Suspended", value: subscriptions?.suspended ?? 0, bar: "bg-gray-400", dot: "bg-gray-400" },
  ];
  const total = bands.reduce((sum, band) => sum + band.value, 0);

  return (
    <Panel title="Subscription health" subtitle={total > 0 ? `${total} shops` : undefined}>
      {loading || subscriptions === undefined ? (
        <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
      ) : total === 0 ? (
        <PanelEmpty>No shops on the platform yet.</PanelEmpty>
      ) : (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            {bands
              .filter((band) => band.value > 0)
              .map((band) => (
                <div
                  key={band.key}
                  className={band.bar}
                  // A width is a number, not a class name: an interpolated
                  // Tailwind class does not exist at build time and renders as
                  // nothing at all.
                  style={{ width: `${(band.value / total) * 100}%` }}
                  title={`${band.label}: ${band.value}`}
                />
              ))}
          </div>

          <ul className="mt-4 grid grid-cols-2 gap-3">
            {bands.map((band) => (
              <li key={band.key} className="flex items-center gap-2.5">
                <span className={`size-2.5 shrink-0 rounded-full ${band.dot}`} />
                <span className="min-w-0 flex-1 truncate text-theme-sm text-gray-600 dark:text-gray-300">
                  {band.label}
                </span>
                <span className="text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">
                  {band.value}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-theme-xs text-gray-400">{label}</p>
      <p className="truncate text-theme-sm font-semibold tabular-nums text-gray-800 dark:text-white/90">{value}</p>
    </div>
  );
}
