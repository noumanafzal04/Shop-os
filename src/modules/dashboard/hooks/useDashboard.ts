import { useQuery } from "@tanstack/react-query";
import { dashboardService } from "../services/dashboardService";

export function useTenantDashboard() {
  return useQuery({
    queryKey: ["dashboard", "tenant"],
    queryFn: async () => (await dashboardService.tenant()).data,
  });
}
