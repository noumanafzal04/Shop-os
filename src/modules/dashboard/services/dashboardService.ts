import { apiGet } from "../../../common/api/client";
import type { AdminDashboard, TenantDashboard } from "../types";

export const dashboardService = {
  tenant: () => apiGet<TenantDashboard>("/dashboard"),
  admin: () => apiGet<AdminDashboard>("/admin/dashboard"),
};
