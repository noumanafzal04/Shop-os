import { useState } from "react";
import { Link } from "react-router";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import { shopDate } from "../../../common/format/date";
import { useMoney } from "../../shop/hooks/useShop";
import type { Customer } from "../services/customersService";
import { KHATA_METHODS, ledgerLine, overpaid, saleLink, standing, type KhataMethod } from "../khata";

export interface KhataPayment {
  amount: number;
  method: KhataMethod;
  allow_advance?: boolean;
}

/** A plan the customer is still paying off (F1) — as the card has it. */
export interface RunningPlan {
  id: string;
  number: string;
  left: number;
  due_now: number;
}

/**
 * A customer's khata on their card: what they owe (or what the shop holds of
 * theirs), a payment, and the statement.
 *
 * ── More than is owed is asked about here, before anything is sent ──────
 *
 * Ali Raza owed 4,227.30 and handed over 4,250 by transfer. The server refuses
 * that unless told to keep the 22.70 as an advance, and its refusal said
 * "Confirm to keep the extra…" on a screen with no confirm — so the payment
 * could not be recorded at all (L13). Now the box asks first: keep the extra,
 * or take only what is owed.
 *
 * ── An installment is asked about too ──────────────────────────────────
 *
 * Money from a customer paying for goods on installments, taken here as a
 * plain khata payment, came off the khata but not off the plan: the plan went
 * on saying "late" for money already in the drawer, and taking it again on the
 * plan would have put it in the drawer twice. So while a plan is running the
 * box asks whether this is an installment, and puts it on the plan if it is.
 */
export default function KhataBox({
  customer,
  pending,
  onPay,
  plans = [],
  onInstallment,
}: {
  customer: Customer;
  pending: boolean;
  /** `done` is called once the payment is in, to clear the box. */
  onPay: (payment: KhataPayment, done: () => void) => void;
  /** The customer's running installment plans; a payment is asked about while there are any. */
  plans?: RunningPlan[];
  onInstallment?: (planId: string, payment: { amount: number; method: KhataMethod }, done: () => void) => void;
}) {
  const money = useMoney();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<KhataMethod>("cash");
  const [asking, setAsking] = useState(false);
  const [askingPlan, setAskingPlan] = useState(false);

  const now = standing(customer.credit_balance);
  const typed = Number(amount);
  const over = overpaid(typed, customer.credit_balance);
  const clear = () => { setAmount(""); setAsking(false); setAskingPlan(false); };
  const onPlans = onInstallment !== undefined && plans.length > 0;

  const send = (payment: KhataPayment) => {
    if (pending) return;
    onPay(payment, clear);
  };
  // Past the installment question: a plain khata payment, asked about if it is more than owed.
  const onTheKhata = () => {
    setAskingPlan(false);
    if (over) { setAsking(true); return; }
    send({ amount: typed, method });
  };
  const take = () => {
    if (!(typed > 0) || pending) return;
    if (onPlans) { setAsking(false); setAskingPlan(true); return; }
    onTheKhata();
  };

  return (
    <div className="mb-4 rounded-xl border border-gray-200 p-3 dark:border-gray-800" data-testid="khata-box">
      <div className="flex items-start justify-between gap-3">
        <span className="pt-1 text-theme-xs font-medium uppercase text-gray-400">Credit (khata)</span>
        <div className="text-right" data-testid="khata-standing">
          {now.kind === "owes" ? (
            <>
              <span className="text-lg font-bold text-error-600 dark:text-error-400">Owes {money(now.amount)}</span>
              {customer.credit_limit != null && (
                <span className="ml-1 text-theme-xs text-gray-400">of {money(customer.credit_limit)} limit</span>
              )}
            </>
          ) : now.kind === "advance" ? (
            <>
              <span className="text-lg font-bold text-success-600 dark:text-success-400">Advance {money(now.amount)}</span>
              <div className="text-theme-xs text-gray-400">In their favour — their next credit sale uses it first</div>
            </>
          ) : (
            <span className="text-theme-sm font-medium text-gray-500 dark:text-gray-400">Nothing owed</span>
          )}
        </div>
      </div>

      {/* On a phone the amount has the row to itself: squeezed beside the
          method and the button it showed 1040.50 as "104", and a shopkeeper
          checks the paisa before pressing (Codex QA 2026-10-16, BUG-72). */}
      <div className="mt-3 flex flex-wrap items-end gap-2 sm:flex-nowrap">
        <div className="w-full sm:w-auto sm:min-w-0 sm:flex-1">
          <Input
            type="number"
            min="0"
            aria-label="Payment amount"
            placeholder={now.kind === "owes" ? "Payment amount" : "Advance amount"}
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setAsking(false); setAskingPlan(false); }}
          />
        </div>
        <select
          aria-label="Paid by"
          value={method}
          onChange={(e) => { setMethod(e.target.value as KhataMethod); setAskingPlan(false); }}
          className="h-11 flex-1 rounded-lg border border-gray-200 bg-transparent px-2 text-theme-sm text-gray-700 sm:flex-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
        >
          {KHATA_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <Button size="sm" onClick={take} disabled={pending || !(typed > 0)}>
          {pending ? "…" : "Take payment"}
        </Button>
      </div>

      {askingPlan && onPlans && (
        <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-500/30 dark:bg-brand-500/10" data-testid="khata-installment" role="alert">
          <p className="text-theme-sm text-gray-700 dark:text-gray-200">
            {customer.name} is paying for goods on installments. Is this {money(typed)} an installment?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {plans.map((pl) => {
              const fits = typed <= pl.left + 0.004;

              return (
                <Button key={pl.id} size="sm" disabled={pending || !fits} onClick={() => onInstallment!(pl.id, { amount: typed, method }, clear)}>
                  {fits ? `Yes — on ${pl.number}` : `${pl.number}: only ${money(pl.left)} left`}
                </Button>
              );
            })}
            <Button size="sm" variant="outline" onClick={onTheKhata} disabled={pending}>No — on the khata</Button>
          </div>
          <p className="mt-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
            {plans.map((pl) => `${pl.number}: ${pl.due_now > 0 ? `${money(pl.due_now)} to bring up to date` : "up to date"} · ${money(pl.left)} left`).join("  ·  ")}
          </p>
        </div>
      )}

      {asking && over && (
        <div className="mt-3 rounded-lg border border-warning-300 bg-warning-50 p-3 dark:border-warning-500/40 dark:bg-warning-500/10" data-testid="khata-overpay" role="alert">
          <p className="text-theme-sm text-gray-700 dark:text-gray-200">
            {over.owed > 0
              ? <>{customer.name} owes {money(over.owed)}. You entered {money(typed)} — {money(over.extra)} more.</>
              : <>{customer.name} owes nothing. {money(typed)} will be kept for them as an advance.</>}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => send({ amount: typed, method, allow_advance: true })} disabled={pending}>
              Keep {money(over.extra)} as advance
            </Button>
            {over.owed > 0 && (
              <Button size="sm" variant="outline" onClick={() => send({ amount: over.owed, method })} disabled={pending}>
                Take {money(over.owed)} only
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setAsking(false)}>Change amount</Button>
          </div>
        </div>
      )}

      {(customer.ledger?.length ?? 0) > 0 && (
        <div className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-gray-100 pt-2 dark:border-gray-800" data-testid="khata-statement">
          {customer.ledger!.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 text-theme-xs">
              <span className="text-gray-500 dark:text-gray-400">
                {shopDate(e.created_at)} · {ledgerLine(e)}
                {e.type === "charge" && e.sale && (
                  <> · <Link to={saleLink(e.sale)} className="text-brand-500 hover:text-brand-600">{e.sale.invoice_number}</Link></>
                )}
              </span>
              <span className={`tabular-nums ${e.type === "charge" ? "text-error-600 dark:text-error-400" : "text-success-600 dark:text-success-400"}`}>
                {e.type === "charge" ? "+" : "−"}{money(e.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
