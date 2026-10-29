import type { PlanLimits } from "./services/adminService";

/**
 * WHAT A PLAN SAYS ABOUT SELLING OFFLINE — in one set of words.
 *
 * The plans page called it "the one capability a plan is really chosen for",
 * and the form that picks a plan for a new shop never said the word at all
 * (admin #AD1). Both now read it from here, so they cannot disagree.
 */
export function planSellsOffline(limits: Pick<PlanLimits, "offline_selling" | "offline_days"> | null | undefined): string {
  if ((limits?.offline_selling ?? 0) <= 0) return "Not included";
  const days = limits?.offline_days ?? 3;

  return `Up to ${days} day${days === 1 ? "" : "s"}`;
}
