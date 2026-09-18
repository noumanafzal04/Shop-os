import { useQuery } from "@tanstack/react-query";
import { dashboardService, type Dashboard } from "../services/dashboardService";

/**
 * How often a shopkeeper's "today" is allowed to be stale.
 *
 * Sixty seconds. Long enough that switching tabs does not fire a request every
 * time, short enough that a figure somebody is watching during service is
 * never more than a minute old. The screen also refetches when the app comes
 * back to the foreground, which is when it is actually being looked at.
 */
export const DASHBOARD_STALE_MS = 60_000;

export function useDashboard(branchId: string | null) {
  return useQuery({
    // The branch is IN the key. Without it, switching branch would show the
    // previous branch's cached figures under the new branch's name — the kind
    // of wrong that looks right.
    queryKey: ["dashboard", branchId],
    queryFn: async (): Promise<Dashboard> => (await dashboardService.get(branchId)).data,
    staleTime: DASHBOARD_STALE_MS,
  });
}
