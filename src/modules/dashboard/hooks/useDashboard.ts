import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { DateRange } from "../../../components/ui/filters";
import { dashboardService } from "../services/dashboardService";

/**
 * Both are keyed by the period, so each period is its own answer and going
 * back to one already read is instant.
 *
 * `keepPreviousData`: while a newly asked period is on its way the last one
 * stays on screen, dimmed, instead of the page collapsing into skeletons at
 * every step of the arrows. The figures say which period THEY are (the
 * payload's own `period`), so nothing is ever labelled as the one still loading.
 *
 * Everything that changes a shop's numbers invalidates `["dashboard"]` — the
 * prefix — and so still reaches every period in the cache.
 */
export function useTenantDashboard(period: DateRange | null = null) {
  return useQuery({
    queryKey: ["dashboard", "tenant", period?.from ?? null, period?.to ?? null],
    queryFn: async () => (await dashboardService.tenant(period)).data,
    placeholderData: keepPreviousData,
  });
}

export function useAdminDashboard(period: DateRange | null = null) {
  return useQuery({
    queryKey: ["dashboard", "admin", period?.from ?? null, period?.to ?? null],
    queryFn: async () => (await dashboardService.admin(period)).data,
    placeholderData: keepPreviousData,
  });
}
