import { apiGet } from "../../../common/api/client";
import type { TenantDashboard } from "../types";

export const dashboardService = {
  tenant: () => apiGet<TenantDashboard>("/dashboard"),
};
