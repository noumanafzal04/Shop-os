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
import { useInstallmentMutations, useInstallmentWorth } from "../hooks/useInstallments";
import { aMonthAfter } from "../installments";
import { useDebouncedValue } from "../../../common/hooks/useDebouncedValue";

/**
 * GOODS GO HOME ON INSTALLMENTS — the terms (F1).
 *
 * After the items are picked: who, the advance now, how many months, and the
 * first due date. The sum is shown before the press — "16,000 now + 10 × 5,000
 * = 66,000" — and it is the SERVER's: the plan it will write, asked as the
 * terms change. It was worked out here from the shelf prices before tax, and
 * read out a bill Rs 691.75 short of the plan written, with no word that the
 * figure had changed (money pass 2026-10-16, $8). The press sends the bill
 * it showed; a price that moved in between is refused, never written.
 */
export default function StartInstallmentModal({
  isOpen,
  onClose,
  lines,
  onDone,
}: {
  isOpen: boolean;
  onClose: () => void;
  lines: Array<{ product_id: string; variant_id?: string | null; quantity: number }>;
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
  const down = Math.max(0, Number(advance) || 0);
  const n = Math.max(1, Math.floor(Number(months) || 0));
  const day = Number(firstDue.slice(8, 10));

  // The plan, as the server will write it — asked a moment after the typing stops.
  const terms = {
    items: lines,
    markup_percent: pct || undefined,
    advance: down > 0 ? { amount: down, method } : undefined,
    months: n,
    customer_phone: phone.trim() || undefined,
  };
  const termsNow = JSON.stringify(terms);
  const askedTerms = useDebouncedValue(termsNow, 300);
  const worth = useInstallmentWorth(JSON.parse(askedTerms), isOpen && lines.length > 0 && n >= 1 && n <= 60);
  const plan = worth.data;
  // Shown only for the terms on screen: a figure for the last terms is not this plan's.
  const current = plan !== undefined && askedTerms === termsNow && !worth.isFetching;
  const refused = worth.error instanceof ApiError ? worth.error.message : worth.isError ? "Couldn't work out the plan." : null;

  // The goods leave the counter on a sale, so a shop that asks for shifts
  // asks for today's here whatever the advance is paid by — the server does.
  const { why: shiftWhy } = useCounterShift("to send goods home");
  const why =
    !phone.trim() ? "The customer's phone — the khata and every installment are found by it."
      : !(n >= 1 && n <= 60) ? "Between 1 and 60 months."
        : !firstDue ? "The first due date."
          : refused;

  const submit = () => {
    if (why || shiftWhy || start.isPending || !current) return;
    start.mutate(
      {
        customer_name: name.trim() || undefined,
        customer_phone: phone.trim(),
        items: lines,
        markup_percent: pct || undefined,
        advance: down > 0 ? { amount: down, method, reference: reference.trim() || undefined } : undefined,
        months: n,
        first_due_on: firstDue,
        expected_total: plan.total,
        idempotency_key: once.key,
      },
      {
        onSuccess: (res) => {
          once.renew();
          toast.success(`Plan ${res.data.number} started — the goods can go home`);
          onDone(res.data);
          onClose();
        },
        onError: (e) => {
          toast.error(e instanceof ApiError ? (e.firstFieldError() ?? e.message) : "The plan was not started — nothing was sold.");
          // The price moved: ask again, so the sheet reads out the plan as it now is.
          if (e instanceof ApiError && e.errorCode === "PLAN_PRICE_CHANGED") void worth.refetch();
        },
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
        {!current ? (
          <p className="text-gray-500 dark:text-gray-400">{refused ?? "Working out the plan…"}</p>
        ) : (
          <>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Cash price</span><span className="tabular-nums">{money(plan.cash_price)}</span></div>
            {plan.markup > 0 && <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Installment charge ({plan.markup_percent}%)</span><span className="tabular-nums">{money(plan.markup)}</span></div>}
            <div className="flex justify-between font-semibold"><span>Bill</span><span className="tabular-nums">{money(plan.total)}</span></div>
            <p className="mt-2 border-t border-brand-200 pt-2 font-medium text-gray-800 dark:border-brand-500/30 dark:text-white/90">
              {money(plan.advance)} now + {plan.monthly === plan.last_month ? `${plan.months} × ${money(plan.monthly)}` : `${plan.months - 1} × ${money(plan.monthly)} + ${money(plan.last_month)}`} = {money(plan.total)}
              {firstDue && <span className="block text-theme-xs font-normal text-gray-500 dark:text-gray-400">First on {shopDate(firstDue)}</span>}
            </p>
          </>
        )}
      </div>

      {(why || shiftWhy) && (
        <div className="mt-3">
          {shiftWhy ? <ShiftNeeded why={shiftWhy} /> : <p className="text-theme-xs text-warning-600 dark:text-warning-400">{why}</p>}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-3">
        <Button size="sm" variant="outline" onClick={onClose}>Back</Button>
        <Button size="sm" onClick={submit} disabled={!!why || !!shiftWhy || !current || start.isPending}>
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
