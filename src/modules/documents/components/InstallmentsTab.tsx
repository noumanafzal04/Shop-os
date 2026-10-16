import { useState } from "react";
import { FilterBar } from "../../../components/ui/filters";
import Pager from "../../../components/ui/pager";
import { ListEmpty } from "../../../common/ui/ListEmpty";
import { shopDate } from "../../../common/format/date";
import { shopWallToday } from "../../../common/shopDay";
import { useMoney } from "../../shop/hooks/useShop";
import { useInstallmentPlans, useInstallmentSummary } from "../hooks/useInstallments";
import { daysUntil, whenDue } from "../installments";
import type { InstallmentPlan, PlanFilter } from "../services/installmentService";

const FILTERS: Array<{ value: PlanFilter; label: string; tone: string }> = [
  { value: "running", label: "Running", tone: "border-brand-500 bg-brand-500 text-white" },
  { value: "late", label: "Late", tone: "border-error-500 bg-error-500 text-white" },
  { value: "due_soon", label: "Due this week", tone: "border-warning-500 bg-warning-500 text-white" },
  { value: "this_month", label: "Due this month", tone: "border-warning-600 bg-warning-600 text-white" },
  { value: "paid_off", label: "Paid off", tone: "border-success-500 bg-success-500 text-white" },
  { value: "closed", label: "Closed", tone: "border-gray-500 bg-gray-500 text-white" },
  { value: "all", label: "All plans", tone: "border-gray-700 bg-gray-700 text-white dark:border-gray-300 dark:bg-gray-300 dark:text-gray-900" },
];

/** What each list holds, said when it is empty. */
const NONE: Record<PlanFilter, string> = {
  running: "No goods are out on installments. Use “Sell on installments” above to start one.",
  late: "Nobody is late.",
  due_soon: "Nothing falls due this week.",
  this_month: "Nothing more falls due this month.",
  paid_off: "No plan has been paid off yet.",
  closed: "No plan has been closed.",
  all: "No goods have gone home on installments yet. Use “Sell on installments” above to start one.",
};

/**
 * EVERYBODY PAYING FOR GOODS ON INSTALLMENTS (F1) — who is late, who is due
 * this week, who is paid off. "Sb mixed hai" (the owner, 2026-10-15): the late
 * ones are red, the ones due within a week amber, the paid-off ones green, and
 * every filter says how many. "To collect" is the column to read at the
 * counter: what is late, and the next month once it is within the week — a
 * customer who paid ahead reads "Up to date", never a sum to take.
 *
 * Each tile opens the plans behind its own figure — "Due this month" opens the
 * plans with something still to come this month, never this week's.
 */
export default function InstallmentsTab({ onOpen }: { onOpen: (planId: string) => void }) {
  const money = useMoney();
  const [status, setStatus] = useState<PlanFilter>("running");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const summary = useInstallmentSummary();
  const list = useInstallmentPlans({ status, search: search.trim() || undefined, page });
  const rows = list.data?.rows ?? [];
  const today = shopWallToday();
  const s = summary.data;
  const show = (to: PlanFilter) => { setStatus(to); setPage(1); };

  return (
    <div data-testid="installments">
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Out on installments" value={money(s?.out ?? 0)} hint={`Across ${s?.counts.running ?? 0} running plan${s?.counts.running === 1 ? "" : "s"}`} onClick={() => show("running")} />
        <Tile label="Late" value={money(s?.late.total ?? 0)} hint={(s?.late.plans ?? 0) > 0 ? `${s!.late.plans} plan${s!.late.plans === 1 ? "" : "s"} — worth a phone call` : "Nobody is late"} tone={(s?.late.plans ?? 0) > 0 ? "late" : undefined} onClick={() => show("late")} />
        <Tile label="Due this month" value={money(s?.due_this_month ?? 0)} hint="Still to come this month — late not included" tone="warn" onClick={() => show("this_month")} />
        <Tile label="Collected this month" value={money(s?.collected_this_month ?? 0)} hint="Installments paid in" tone="good" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show plans" data-testid="installment-filters">
        {FILTERS.map(({ value, label, tone }) => {
          const on = status === value;
          const n = s?.counts[value];

          return (
            <button key={value} type="button" aria-pressed={on} onClick={() => show(value)}
              className={`rounded-full border px-3 py-1.5 text-theme-sm font-medium transition ${on ? tone : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"}`}>
              {label}{n != null && <span className={`ml-1.5 tabular-nums ${on ? "text-white/80" : "text-gray-400"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <FilterBar search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: "Plan, customer, phone, bill or item…", label: "Search plans" }} />

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
        {list.isLoading ? (
          <div className="space-y-2 p-5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />)}</div>
        ) : rows.length === 0 ? (
          <ListEmpty from={list} what="the installment plans">
            <p className="py-14 text-center text-theme-sm text-gray-500 dark:text-gray-400">
              {search.trim() ? `No plan matches “${search.trim()}” here.` : NONE[status]}
            </p>
          </ListEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-theme-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
                  <th className="px-5 py-2.5 font-medium">Plan</th>
                  <th className="px-3 py-2.5 font-medium">Customer</th>
                  <th className="px-3 py-2.5 font-medium">Items</th>
                  <th className="px-3 py-2.5 text-right font-medium">Bill</th>
                  <th className="px-3 py-2.5 font-medium">Paid</th>
                  <th className="px-3 py-2.5 text-right font-medium">Left</th>
                  <th className="px-3 py-2.5 text-right font-medium">Monthly</th>
                  <th className="bg-brand-50 px-3 py-2.5 text-right font-semibold text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">To collect</th>
                  <th className="px-3 py-2.5 font-medium">Next due</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => <Row key={p.id} plan={p} today={today} money={money} onOpen={onOpen} />)}
              </tbody>
            </table>
          </div>
        )}
        <Pager pagination={list.data?.pagination} onPage={setPage} noun="plans" />
      </section>
    </div>
  );
}

function Row({ plan: p, today, money, onOpen }: { plan: InstallmentPlan; today: string; money: (n: string | number) => string; onOpen: (id: string) => void }) {
  const s = p.standing;
  const share = Number(p.financed) > 0 ? Math.min(1, s.paid / Number(p.financed)) : 1;
  const late = p.status === "running" && s.late > 0;
  const soon = p.status === "running" && !late && s.next_due_on !== null && daysUntil(s.next_due_on, today) <= 7;
  const tint = late ? "bg-error-50/50 hover:bg-error-50 dark:bg-error-500/[0.06]"
    : soon ? "bg-warning-50/50 hover:bg-warning-50 dark:bg-warning-500/[0.06]"
      : p.status === "paid_off" ? "bg-success-50/50 dark:bg-success-500/[0.05]"
        : "hover:bg-gray-50 dark:hover:bg-white/[0.02]";

  return (
    <tr className={`cursor-pointer border-b border-gray-100 last:border-0 dark:border-gray-800 ${tint}`} onClick={() => onOpen(p.id)} data-state={late ? "late" : soon ? "due_soon" : p.status}>
      <td className="px-5 py-3">
        <span className="font-medium text-brand-500">{p.number}</span>
        <span className="block text-theme-xs text-gray-400">{shopDate(p.created_at)}</span>
      </td>
      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
        {p.customer_name ?? "—"}
        {p.customer_phone && (
          <a href={`tel:${p.customer_phone}`} onClick={(e) => e.stopPropagation()} className="block text-theme-xs text-brand-500 hover:text-brand-600">{p.customer_phone}</a>
        )}
      </td>
      <td className="max-w-[12rem] truncate px-3 py-3 text-theme-xs text-gray-500 dark:text-gray-400">{p.items.map((i) => (i.quantity === 1 ? i.name : `${i.quantity} × ${i.name}`)).join(", ") || "—"}</td>
      <td className="px-3 py-3 text-right tabular-nums">{money(p.total)}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div className={`h-full rounded-full ${p.status === "paid_off" ? "bg-success-500" : "bg-brand-500"}`} style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
          <span className="text-theme-xs tabular-nums text-gray-500 dark:text-gray-400">{s.months_paid} of {p.months}</span>
        </div>
      </td>
      <td className={`px-3 py-3 text-right font-semibold tabular-nums ${late ? "text-error-600 dark:text-error-400" : p.status === "running" ? "text-gray-800 dark:text-white/90" : "text-gray-400"}`}>{money(s.left)}</td>
      <td className="px-3 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{money(p.monthly)}</td>
      <td className="bg-brand-50/70 px-3 py-3 text-right tabular-nums dark:bg-brand-500/[0.07]" data-testid="to-collect">
        {p.status !== "running" ? <span className="text-gray-400">—</span>
          : s.due_now > 0 ? <span className={`font-semibold ${late ? "text-error-600 dark:text-error-400" : "text-warning-600 dark:text-warning-400"}`}>{money(s.due_now)}</span>
            : <span className="text-theme-xs font-medium text-success-600 dark:text-success-400">Up to date</span>}
      </td>
      <td className="px-3 py-3 text-theme-xs">
        {p.status === "paid_off" ? <span className="font-semibold text-success-600 dark:text-success-400">Paid off</span>
          : p.status === "closed" ? <span className="text-gray-400">Closed</span>
            : late ? <span className="font-semibold text-error-600 dark:text-error-400">Late {s.late_months} month{s.late_months === 1 ? "" : "s"} · {money(s.late)}</span>
              : s.next_due_on ? <span className={soon ? "font-medium text-warning-600 dark:text-warning-400" : "text-gray-500 dark:text-gray-400"}>{shopDate(s.next_due_on)} · {whenDue(s.next_due_on, today)}</span>
                : "—"}
      </td>
      <td className="px-5 py-3 text-right">
        {p.status === "running" && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(p.id); }} className="text-theme-sm font-medium text-brand-500 hover:text-brand-600">
            Take installment
          </button>
        )}
      </td>
    </tr>
  );
}

function Tile({ label, value, hint, tone, onClick }: { label: string; value: string; hint: string; tone?: "warn" | "late" | "good"; onClick?: () => void }) {
  const accent = tone === "late" ? "text-error-600 dark:text-error-400" : tone === "warn" ? "text-warning-600 dark:text-warning-400" : tone === "good" ? "text-success-600 dark:text-success-400" : "text-gray-800 dark:text-white/90";
  const body = (
    <>
      <div className="text-theme-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
      <div className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">{hint}</div>
    </>
  );
  const shell = "rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]";

  return onClick
    ? <button type="button" onClick={onClick} className={`${shell} transition hover:border-brand-300 dark:hover:border-brand-500/40`}>{body}</button>
    : <div className={shell}>{body}</div>;
}
