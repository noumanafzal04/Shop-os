import { useEffect, useState } from "react";
import { Modal } from "../../../components/ui/modal";
import Button from "../../../components/ui/button/Button";
import Input from "../../../components/form/input/InputField";
import Label from "../../../components/form/Label";
import DateField from "../../../components/form/DateField";
import { useToast } from "../../../components/ui/toast";
import { ApiError } from "../../../common/types/api";
import { useOnceKey } from "../../../common/onceKey";
import { shopWallToday } from "../../../common/shopDay";
import { shopDate } from "../../../common/format/date";
import { useMoney } from "../../shop/hooks/useShop";
import { useCounterShift } from "../../pos/hooks/useCounterShift";
import { ShiftNeeded } from "../../pos/components/ShiftNeeded";
import { CustomerSuggestions } from "../../customers/components/CustomerSuggestions";
import { DEPOSIT_METHODS } from "../services/documentService";
import type { InstallmentPlan } from "../services/installmentService";
import { useInstallmentMutations } from "../hooks/useInstallments";
import { aMonthAfter, split } from "../installments";

/**
 * GOODS GO HOME ON INSTALLMENTS — the terms (F1).
 *
 * After the items are picked: who, the advance now, how many months, and the
 * first due date. The sum is shown before the press — "16,000 now + 10 × 5,000
 * = 66,000" — worked out the server's way from the shelf prices. The server
 * prices the goods itself when the plan is saved; its figures are the plan's.
 */
export default function StartInstallmentModal({
  isOpen,
  onClose,
  lines,
  about,
  onDone,
}: {
  isOpen: boolean;
  onClose: () => void;
  lines: Array<{ product_id: string; variant_id?: string | null; quantity: number }>;
  /** The shelf prices added up — the server's price is the plan's. */
  about: number;
  onDone: (plan: InstallmentPlan) => void;
}) {
  const money = useMoney();
  const toast = useToast();
  const once = useOnceKey();
  const { start } = useInstallmentMutations();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [markup, setMarkup] = useState("");
  const [advance, setAdvance] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [months, setMonths] = useState("6");
  const [firstDue, setFirstDue] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setName(""); setPhone(""); setMarkup(""); setAdvance(""); setMethod("cash"); setReference(""); setMonths("6");
    setFirstDue(aMonthAfter(shopWallToday()));
  }, [isOpen]);

  const pct = Math.max(0, Number(markup) || 0);
  const charge = Math.round((about * pct) / 100);
  const bill = about + charge;
  const down = Math.max(0, Number(advance) || 0);
  const n = Math.max(1, Math.floor(Number(months) || 0));
  const financed = Math.round((bill - down) * 100) / 100;
  const plan = financed > 0 ? split(financed, n) : null;
  const day = Number(firstDue.slice(8, 10));

  // The goods leave the counter on a sale, so a shop that asks for shifts
  // asks for today's here whatever the advance is paid by — the server does.
  const { why: shiftWhy } = useCounterShift("to send goods home");
  const why =
    !phone.trim() ? "The customer's phone — the khata and every installment are found by it."
      : down >= about ? "The advance covers the whole price — ring it as a sale instead."
        : !(n >= 1 && n <= 60) ? "Between 1 and 60 months."
          : !firstDue ? "The first due date."
            : null;

  const submit = () => {
    if (why || shiftWhy || start.isPending) return;
    start.mutate(
      {
        customer_name: name.trim() || undefined,
        customer_phone: phone.trim(),
        items: lines,
        markup_percent: pct || undefined,
        advance: down > 0 ? { amount: down, method, reference: reference.trim() || undefined } : undefined,
        months: n,
        first_due_on: firstDue,
        idempotency_key: once.key,
      },
      {
        onSuccess: (res) => {
          once.renew();
          toast.success(`Plan ${res.data.number} started — the goods can go home`);
          onDone(res.data);
          onClose();
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "The plan was not started — nothing was sold."),
      },
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-1 text-lg font-semibold text-gray-800 dark:text-white/90">Sell on installments</h3>
      <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
        The goods go home today. An advance now, the rest month by month on the customer's khata.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="ins-name">Customer</Label>
          <Input id="ins-name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ins-phone">Phone *</Label>
          <Input id="ins-phone" placeholder="03xx-xxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <CustomerSuggestions name={name} phone={phone} onPick={(c) => { setName(c.name ?? ""); setPhone(c.phone ?? ""); }} />
        </div>

        <div>
          <Label htmlFor="ins-markup">Installment charge %</Label>
          <Input id="ins-markup" type="number" min="0" max="100" placeholder="0" value={markup} onChange={(e) => setMarkup(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ins-months">Months *</Label>
          <Input id="ins-months" type="number" min="1" max="60" value={months} onChange={(e) => setMonths(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="ins-advance">Advance now</Label>
          <Input id="ins-advance" type="number" min="0" placeholder="0" value={advance} onChange={(e) => setAdvance(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ins-method">Paid by</Label>
          <select
            id="ins-method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-3 text-theme-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            {DEPOSIT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        {method !== "cash" && down > 0 && (
          <div className="sm:col-span-2">
            <Input placeholder="Reference (optional)" aria-label="Advance reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        )}

        <div className="sm:col-span-2">
          <Label htmlFor="ins-first">First installment due *</Label>
          <DateField id="ins-first" value={firstDue} onChange={setFirstDue} min={shopWallToday()} />
          {day > 0 && (
            <p className="mt-1 text-theme-xs text-gray-400">
              Then the {day > 28 ? `${day}th (or the month's last day)` : ordinal(day)} of each month.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/40 p-3 text-theme-sm dark:border-brand-500/30 dark:bg-brand-500/[0.06]" data-testid="installment-preview">
        <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Cash price (shelf)</span><span className="tabular-nums">{money(about)}</span></div>
        {charge > 0 && <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Installment charge ({pct}%)</span><span className="tabular-nums">{money(charge)}</span></div>}
        <div className="flex justify-between font-semibold"><span>Bill</span><span className="tabular-nums">{money(bill)}</span></div>
        {plan && (
          <p className="mt-2 border-t border-brand-200 pt-2 font-medium text-gray-800 dark:border-brand-500/30 dark:text-white/90">
            {money(down)} now + {plan.monthly === plan.last ? `${n} × ${money(plan.monthly)}` : `${n - 1} × ${money(plan.monthly)} + ${money(plan.last)}`} = {money(bill)}
            {firstDue && <span className="block text-theme-xs font-normal text-gray-500 dark:text-gray-400">First on {shopDate(firstDue)}</span>}
          </p>
        )}
      </div>

      {(why || shiftWhy) && (
        <div className="mt-3">
          {shiftWhy ? <ShiftNeeded why={shiftWhy} /> : <p className="text-theme-xs text-warning-600 dark:text-warning-400">{why}</p>}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-3">
        <Button size="sm" variant="outline" onClick={onClose}>Back</Button>
        <Button size="sm" onClick={submit} disabled={!!why || !!shiftWhy || start.isPending}>
          {start.isPending ? "Starting…" : "Hand over & start plan"}
        </Button>
      </div>
    </Modal>
  );
}

function ordinal(d: number): string {
  const s = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th";

  return `${d}${s}`;
}
