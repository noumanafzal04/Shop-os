import type { Tenant } from "../auth/types";

/**
 * DOES THIS SHOP SELL OFFLINE ONLY BECAUSE AN ADMIN SAID SO? (#OF-K)
 *
 * A grant beats the plan for good — after a downgrade too. A shop granted
 * offline selling on Pro and moved to Basic kept selling offline while its
 * days fell 7 → 1, and its page read the same either way. Said, not silently
 * cleared: the grant was somebody's decision, and the page now names it.
 */
export function sellsOfflineOnlyByGrant(tenant: Pick<Tenant, "limits" | "limits_usage">): boolean {
  const granted = (tenant.limits?.offline_selling ?? 0) === 1;
  const plan = tenant.limits_usage?.find((u) => u.key === "offline_selling")?.baseline;

  return granted && plan === 0;
}
