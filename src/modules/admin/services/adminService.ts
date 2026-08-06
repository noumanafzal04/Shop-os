import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import type { Tenant } from "../../auth/types";

/** Plan ceilings — null = unlimited for that resource. */
export interface PlanLimits {
  products: number | null;
  branches: number | null;
  staff: number | null;
  storage_mb: number | null;
  orders_month: number | null;
}

export interface Plan {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  price: string | number;
  billing_period_months?: number;
  online_shop_enabled: boolean;
  grace_period_days?: number;
  /** Module flags the plan grants (pos, expenses, marketplace, products). */
  features?: Record<string, boolean>;
  limits?: PlanLimits;
  is_active?: boolean;
  tenants_count?: number;
}

export interface PlanInput {
  name: string;
  code: string;
  // null explicitly CLEARS the description on update (undefined would be
  // dropped from the JSON body, leaving the old text in place).
  description?: string | null;
  price: number;
  billing_period_months: number;
  online_shop_enabled: boolean;
  grace_period_days: number;
  /** Module selection (POS/Expense/Online); server derives products/expenses. */
  features?: Record<string, boolean>;
  // Limits — null/omitted = unlimited.
  max_products?: number | null;
  max_branches?: number | null;
  max_staff?: number | null;
  max_storage_mb?: number | null;
  max_orders_month?: number | null;
  is_active?: boolean;
}

export interface Banner {
  id: string;
  title: string | null;
  image_path: string;
  image_url: string | null;
  target_type: "shop" | "product" | "url" | "none";
  tenant_id: string | null;
  advertiser?: { id: string; business_name: string; slug: string } | null;
  target_product_id: string | null;
  target_url: string | null;
  placement: string;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  amount: string | number | null;
  paid_at: string | null;
  notes: string | null;
  impression_count: number;
  click_count: number;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: "tenants" | "customers" | "all";
  link: string | null;
  image_path: string | null;
  image_url: string | null;
  is_published: boolean;
  published_at: string | null;
  recipients_count: number;
  created_at: string;
}

export interface TenantInput {
  business_name: string;
  // null clears the field on an update; the API's rules take null, not "".
  email?: string | null;
  phone?: string | null;
  business_type: string;
  business_category?: string | null;
  city_id?: string | null;
  plan_id?: string;
  owner: { name: string; email?: string; phone?: string; password: string };
}

export interface Payment {
  id: string;
  tenant: { id: string; business_name: string };
  plan_name: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  period_start: string;
  period_end: string;
  paid_at: string;
}

export interface BillingSummary {
  revenue: { this_month: number; this_year: number; all_time: number };
  subscriptions: { active: number; expiring_soon: number; expired: number; suspended: number };
  recent_payments: Array<{ tenant: string; plan_name: string; amount: string; paid_at: string }>;
}

export const adminService = {
  tenants: (params: { search?: string; status?: string; page?: number }) =>
    apiGet<Tenant[]>("/admin/tenants", {
      params: {
        search: params.search || undefined,
        status: params.status || undefined,
        with_deleted: true,
        page: params.page ?? 1,
      },
    }),

  tenant: (id: string) => apiGet<Tenant>(`/admin/tenants/${id}`),

  createTenant: (payload: TenantInput) => apiPost<Tenant>("/admin/tenants", payload),

  updateTenant: (id: string, payload: Partial<TenantInput>) =>
    apiPut<Tenant>(`/admin/tenants/${id}`, payload),

  suspendTenant: (id: string) => apiPost<Tenant>(`/admin/tenants/${id}/suspend`),
  activateTenant: (id: string) => apiPost<Tenant>(`/admin/tenants/${id}/activate`),
  deleteTenant: (id: string) => apiDelete<null>(`/admin/tenants/${id}`),
  restoreTenant: (id: string) => apiPost<Tenant>(`/admin/tenants/${id}/restore`),

  assignPlan: (
    id: string,
    payload: { plan_id: string; payment?: { amount?: number; method?: string; reference?: string } },
  ) => apiPost<Tenant>(`/admin/tenants/${id}/assign-plan`, payload),

  banners: () => apiGet<Banner[]>("/admin/banners"),
  createBanner: (data: FormData) => apiPost<Banner>("/admin/banners", data),
  updateBanner: (id: string, data: FormData) => apiPost<Banner>(`/admin/banners/${id}`, data),
  deleteBanner: (id: string) => apiDelete<null>(`/admin/banners/${id}`),

  announcements: () => apiGet<Announcement[]>("/admin/announcements"),
  createAnnouncement: (data: FormData) => apiPost<Announcement>("/admin/announcements", data),
  updateAnnouncement: (id: string, data: FormData) => apiPost<Announcement>(`/admin/announcements/${id}`, data),
  sendAnnouncement: (id: string) => apiPost<Announcement>(`/admin/announcements/${id}/send`),
  deleteAnnouncement: (id: string) => apiDelete<null>(`/admin/announcements/${id}`),

  moduleCatalog: () => apiGet<Array<{ key: string; label: string; description: string }>>("/admin/modules"),
  updateModules: (id: string, modules: Record<string, boolean>) =>
    apiPut<Tenant>(`/admin/tenants/${id}/modules`, { modules }),

  /** Extend (or clear, via null) a single tenant's limits past its plan. */
  /**
   * `mode: "add"` treats each number as an INCREASE on the tenant's current
   * ceiling — which is what "extend by 100" means. `"set"` writes the number
   * as the new ceiling. The server refuses either one that would land below
   * what the tenant already uses.
   */
  extendLimits: (id: string, limits: Record<string, number | null>, mode: "add" | "set" = "set") =>
    apiPut<Tenant>(`/admin/tenants/${id}/limits`, { limits, mode }),

  plans: () => apiGet<Plan[]>("/admin/plans"),
  createPlan: (payload: PlanInput) => apiPost<Plan>("/admin/plans", payload),
  updatePlan: (id: string, payload: Partial<PlanInput>) => apiPut<Plan>(`/admin/plans/${id}`, payload),
  deletePlan: (id: string) => apiDelete<null>(`/admin/plans/${id}`),
  cities: () => apiGet<Array<{ id: string; name: string }>>("/cities"),

  payments: (params: { tenant_id?: string; page?: number }) =>
    apiGet<Payment[]>("/admin/billing/payments", {
      params: { tenant_id: params.tenant_id || undefined, page: params.page ?? 1 },
    }),

  billingSummary: () => apiGet<BillingSummary>("/admin/billing/summary"),
};
