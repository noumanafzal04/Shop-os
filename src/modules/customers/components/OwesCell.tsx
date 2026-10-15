import { useMoney } from "../../shop/hooks/useShop";
import type { Customer } from "../services/customersService";
import { limitUse, standing } from "../khata";

/**
 * What a customer owes, on their row — red, with how far into their limit they
 * are; "Advance" in green when the shop holds their money; a dash when clear.
 */
export default function OwesCell({ customer }: { customer: Pick<Customer, "credit_balance" | "credit_limit"> }) {
  const money = useMoney();
  const now = standing(customer.credit_balance);
  const use = limitUse(customer.credit_balance, customer.credit_limit);

  if (now.kind === "advance") {
    return <span className="font-medium text-success-600 dark:text-success-400">Advance {money(now.amount)}</span>;
  }
  if (now.kind === "clear") return <span className="text-gray-400">—</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        {use?.state === "over" && <span className="rounded bg-error-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-error-700 dark:bg-error-500/20 dark:text-error-300">Over limit</span>}
        {use?.state === "near" && <span className="rounded bg-warning-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-700 dark:bg-warning-500/20 dark:text-warning-300">Near limit</span>}
        <span className="font-semibold tabular-nums text-error-600 dark:text-error-400">{money(now.amount)}</span>
      </div>
      {use && (
        <div className="flex items-center gap-1.5" title={`${Math.round(use.share * 100)}% of a ${money(customer.credit_limit!)} limit`}>
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className={`h-full rounded-full ${use.state === "over" ? "bg-error-500" : use.state === "near" ? "bg-warning-500" : "bg-brand-400"}`}
              style={{ width: `${Math.min(100, Math.round(use.share * 100))}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-gray-400">of {money(customer.credit_limit!)}</span>
        </div>
      )}
    </div>
  );
}
