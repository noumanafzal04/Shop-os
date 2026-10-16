import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Modal } from "../../../components/ui/modal";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useOnceKey } from "../../../common/onceKey";
import { shopDate } from "../../../common/format/date";
import { shopWallToday } from "../../../common/shopDay";
import { useMoney } from "../../shop/hooks/useShop";
import { useCashNeedsShift } from "../../pos/hooks/useCounterShift";
import { ShiftNeeded } from "../../pos/components/ShiftNeeded";
import { KHATA_METHODS, methodWords, saleLink } from "../../customers/khata";
import { useInstallmentMutations, useInstallmentPlan } from "../hooks/useInstallments";
import { whenDue, type MonthState } from "../installments";

const STATE: Record<MonthState, { label: string; tone: string }> = {
  paid: { label: "Paid", tone: "bg-success-100 text-success-700 dark:bg-success-500/20 dark:text-success-300" },
  late: { label: "Late", tone: "bg-error-100 text-error-700 dark:bg-error-500/20 dark:text-error-300" },
  due: { label: "Due", tone: "bg-warning-100 text-warning-700 dark:bg-warning-500/20 dark:text-warning-300" },
  upcoming: { label: "Upcoming", tone: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
};

/**
 * ONE PLAN, MONTH BY MONTH (F1) — what was agreed, what is paid, what is late,
 * and an installment taken right here. Every figure is the server's; the
 * amount to take starts at what brings the customer up to date.
 */
export default function InstallmentPlanSheet({ planId, onClose }: { planId: string | null; onClose: () => void }) {
  const money = useMoney();
  const toast = useToast();
  const once = useOnceKey();
  const plan = useInstallmentPlan(planId);
  const { pay } = useInstallmentMutations();
  const p = plan.data;
  const s = p?.standing;

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  useEffect(() => {
    if (s) setAmount(s.due_now > 0 ? String(s.due_now) : "");
    setReference("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, p?.paid]);

  const taking = Number(amount) || 0;
  const shiftWhy = useCashNeedsShift(method, taking);
  const tooMuch = s !== undefined && taking > s.left + 0.004;
  // What the amount box can be filled with in one press: up to date, one
  // month, or everything left — each a figure the server sent.
  const quick = !p || !s ? [] : ([
    ["Up to date", s.due_now],
    ["One month", Number(p.monthly)],
    ["All that is left", s.left],
  ] as Array<[string, number]>).filter(([, v], i, all) => v > 0 && v <= s.left + 0.004 && all.findIndex(([, w]) => w === v) === i);

  const take = () => {
    if (!p || !(taking > 0) || tooMuch || shiftWhy || pay.isPending) return;
    pay.mutate(
      { id: p.id, amount: taking, method, reference: reference.trim() || undefined, idempotency_key: once.key },
      {
        onSuccess: () => { once.renew(); toast.success(`${money(taking)} taken on ${p.number}`); },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "That installment was not recorded — nothing changed."),
      },
    );
  };

  return (
    <Modal isOpen={planId !== null} onClose={onClose} className="max-w-2xl p-6">
      {!p || !s ? (
        <div className="h-48 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      ) : (
        <div data-testid="installment-plan">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                {p.number}{" "}
                {p.status === "paid_off" && <span className="ml-1 rounded-full bg-success-100 px-2 py-0.5 text-theme-xs font-semibold text-success-700 dark:bg-success-500/20 dark:text-success-300">Paid off</span>}
                {p.status === "closed" && <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-theme-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">Closed</span>}
              </h3>
              <p className="text-theme-sm text-gray-600 dark:text-gray-300">
                <Link to={`/tenant/customers?q=${encodeURIComponent(p.customer_phone ?? p.customer_name ?? "")}`} className="text-brand-500 hover:text-brand-600">{p.customer_name ?? "Customer"}</Link>
                {p.customer_phone && <> · <a href={`tel:${p.customer_phone}`} className="text-brand-500 hover:text-brand-600">{p.customer_phone}</a></>}
                {p.sale && <> · <Link to={saleLink(p.sale)} className="text-brand-500 hover:text-brand-600">{p.sale.invoice_number}</Link></>}
              </p>
              <p className="text-theme-xs text-gray-400">{p.items.map((i) => (i.quantity === 1 ? i.name : `${i.quantity} × ${i.name}`)).join(", ")}</p>
            </div>
            <div className="text-right">
              <div className="text-theme-xs uppercase tracking-wide text-gray-400">Left to pay</div>
              <div className="text-2xl font-semibold tabular-nums text-gray-800 dark:text-white/90">{money(s.left)}</div>
              <div className="text-theme-xs text-gray-400">{s.months_paid} of {p.months} months paid</div>
            </div>
          </div>

          {s.late > 0 && (
            <div className="mb-3 rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-theme-sm font-medium text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300" role="alert">
              Late {s.late_months} month{s.late_months === 1 ? "" : "s"} · {money(s.late)}
            </div>
          )}

          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-theme-sm sm:grid-cols-4">
            <Fig label="Cash price" value={money(p.cash_price)} />
            {Number(p.markup) > 0 && <Fig label={`Installment charge (${Number(p.markup_percent)}%)`} value={money(p.markup)} />}
            <Fig label="Bill" value={money(p.total)} />
            <Fig label="Advance" value={money(p.advance)} />
            <Fig label="Installments paid" value={money(p.collected ?? s.paid)} />
            {(p.returned ?? 0) > 0 && <Fig label="Goods returned" value={money(p.returned!)} />}
            <Fig label="Monthly" value={Number(p.last_month) === Number(p.monthly) || p.months === 1 ? `${money(p.monthly)} × ${p.months}` : `${money(p.monthly)} × ${p.months - 1} + ${money(p.last_month)}`} />
            <Fig label="Next due" value={s.next_due_on ? `${shopDate(s.next_due_on)}${s.late > 0 ? "" : ` · ${whenDue(s.next_due_on, shopWallToday())}`}` : "—"} />
          </dl>

          {p.status === "running" && (
            <div className="mb-4 rounded-xl border border-gray-200 p-3 dark:border-gray-800" data-testid="take-installment">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[8rem] flex-1">
                  <Input type="number" min="0" aria-label="Installment amount" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <select aria-label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)}
                  className="h-11 rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                  {KHATA_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                {method !== "cash" && (
                  <div className="min-w-[8rem] flex-1"><Input aria-label="Reference" placeholder="Reference" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
                )}
                <Button size="sm" onClick={take} disabled={!(taking > 0) || tooMuch || !!shiftWhy || pay.isPending}>
                  {pay.isPending ? "…" : "Take installment"}
                </Button>
              </div>
              {quick.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Fill the amount">
                  {quick.map(([label, v]) => (
                    <button key={label} type="button" onClick={() => setAmount(String(v))}
                      className={`rounded-full border px-2.5 py-1 text-theme-xs font-medium transition ${taking === v ? "border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300" : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"}`}>
                      {label} · {money(v)}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400" data-testid="installment-after">
                {tooMuch ? <span className="font-medium text-warning-600">Only {money(s.left)} is left on this plan — take that, or less.</span>
                  : taking > 0 ? (Math.abs(taking - s.left) < 0.005
                    ? <span className="font-medium text-success-600 dark:text-success-400">This pays {p.number} off.</span>
                    : <>After this, {money(Math.round((s.left - taking) * 100) / 100)} is left. It fills the oldest month first.</>)
                    : "It fills the oldest month first."}
              </p>
              {shiftWhy && <div className="mt-2"><ShiftNeeded why={shiftWhy} /></div>}
            </div>
          )}

          <div className="mb-4 max-h-64 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-theme-sm" data-testid="installment-months">
              <thead className="sticky top-0 bg-white dark:bg-gray-900">
                <tr className="text-left text-theme-xs uppercase tracking-wide text-gray-400">
                  <th className="px-3 py-2 font-medium">Month</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(s.rows ?? []).map((r) => (
                  <tr key={r.n} className={`border-t border-gray-100 dark:border-gray-800 ${r.state === "late" ? "bg-error-50/50 dark:bg-error-500/[0.06]" : r.state === "due" ? "bg-warning-50/50 dark:bg-warning-500/[0.06]" : r.state === "paid" ? "text-gray-400 dark:text-gray-500" : ""}`}>
                    <td className="px-3 py-1.5 tabular-nums">{r.n}</td>
                    <td className="px-3 py-1.5">{shopDate(r.due_on)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(r.amount)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">{r.paid > 0 ? money(r.paid) : "—"}</td>
                    <td className="px-3 py-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE[r.state].tone}`}>
                        {r.state !== "paid" && r.paid > 0 ? `Part · ${STATE[r.state].label}` : STATE[r.state].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mb-1 text-theme-xs font-medium uppercase text-gray-400">Payments</p>
          <div className="space-y-1 text-theme-sm">
            <div className="flex justify-between text-gray-500 dark:text-gray-400">
              <span>{shopDate(p.created_at)} · Advance</span><span className="tabular-nums">{money(p.advance)}</span>
            </div>
            {(p.payments ?? []).map((e) => (
              <div key={e.id} className="flex justify-between text-gray-600 dark:text-gray-300">
                <span>{e.at ? shopDate(e.at) : "—"} · {e.method === "return" ? "Goods returned" : e.method === "cancellation" ? "Sale cancelled" : methodWords(e.method)}{e.reference ? ` · ${e.reference}` : ""}{e.taken_by ? ` · ${e.taken_by}` : ""}</span>
                <span className="tabular-nums">{money(e.amount)}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 flex justify-end"><Button size="sm" variant="outline" onClick={onClose}>Close</Button></div>
        </div>
      )}
    </Modal>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-theme-xs text-gray-400">{label}</dt>
      <dd className="font-medium leading-snug tabular-nums text-gray-800 dark:text-white/90">{value}</dd>
    </div>
  );
}
