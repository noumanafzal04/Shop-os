import type { TenantPackage } from "./services/adminService";

/** What to suggest in the Amount box of "Assign / renew plan". */
export interface RenewalDue {
  amount: number;
  /** How the figure is made up, for the line under the box. */
  says: string;
}

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;

/**
 * WHAT THIS SHOP WOULD BE PAYING, said under the box it is typed into.
 *
 * The dialog asked for an amount and gave no figure. The shop's bill — its
 * plan AND whatever was switched on past it — is on another card of the same
 * page, so an admin renewing a shop with two add-ons either scrolled away to
 * add it up, or typed the plan's price and under-recorded the month by the
 * add-ons. The create form has said its figure since add-ons could be priced;
 * the renewal, which is the same question asked every month, did not.
 *
 * OFFERED, never filled in. The box left blank is how a free assignment is
 * recorded, so a figure that arrived already typed would turn "I only meant
 * to change the plan" into a payment nobody took.
 *
 * Renewing the plan it is on: the bill as it stands. Moving to another plan:
 * only that plan's price is known here — what is an add-on depends on what the
 * new plan includes, and that is worked out when it is assigned.
 */
export function renewalDue(
  bill: TenantPackage["bill"] | null | undefined,
  currentPlanId: string | null | undefined,
  chosen: { id: string; name: string; price: number | string } | null | undefined,
): RenewalDue | null {
  if (!chosen) return null;

  const price = Number(chosen.price);

  if (bill && currentPlanId && chosen.id === currentPlanId) {
    if (bill.total <= 0) return null;

    const addons = bill.addons_total;
    const count = bill.addons.filter((a) => a.monthly > 0).length;

    return {
      amount: Math.round(bill.total),
      says:
        addons > 0
          ? `${rs(bill.plan.price)} plan + ${rs(addons)} for ${count} add-on${count === 1 ? "" : "s"} = ${rs(bill.total)}.`
          : `${chosen.name} is ${rs(bill.total)}, and this shop has no paid add-ons.`,
    };
  }

  if (!(price > 0)) return null;

  return {
    amount: Math.round(price),
    says: `${chosen.name} is ${rs(price)}. Any add-ons are worked out once the shop is on it.`,
  };
}
