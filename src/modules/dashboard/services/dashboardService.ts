import { apiGet } from "../../../common/api/client";
import type { DateRange } from "../../../components/ui/filters";
import type { AdminDashboard, TenantDashboard } from "../types";

/**
 * A period, as the API takes it. Sent with NEITHER date when no period is
 * named: the server then answers with the one the screen opens on, by its own
 * clock — which is the only clock that knows what day it is there.
 */
const asked = (period: DateRange | null) =>
  period?.from && period.to ? { params: { from: period.from, to: period.to } } : undefined;

export const dashboardService = {
  tenant: (period: DateRange | null = null) => apiGet<TenantDashboard>("/dashboard", asked(period)),
  admin: (period: DateRange | null = null) => apiGet<AdminDashboard>("/admin/dashboard", asked(period)),
};
