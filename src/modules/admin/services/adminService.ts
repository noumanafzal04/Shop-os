import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import type { PaymentStatus, Tenant, User } from "../../auth/types";

/**
 * The billing window a subscription covers, and when the money for it arrived.
 *
 * Two separate facts on purpose: a shop that pays three days late has not
 * bought three fewer days, and a shop entered on Monday may have paid on
 * Thursday. Omit the period entirely and the server derives it from the plan,
 * starting today — which is right for a shop signing up now and wrong for
 * every shop migrating onto the platform mid-cycle.
 */
export interface BillingPeriodInput {
  starts_at?: string;
  ends_at?: string;
}

export interface SubscriptionPaymentInput {
  amount?: number;
  method?: string;
  reference?: string;
  notes?: string;
  /** When the money actually arrived. Backdatable; never in the future. */
  paid_at?: string;
}

/**
 * Bucket totals that ride along on every tenant-list response, computed
 * against the same search but WITHOUT the bucket filter — so the tabs read
 * "Unpaid (3)" without a second round trip, and an admin who never opens the
 * tab still sees that three shops are behind.
 *
 * `all` is not the sum of the other four: a deleted business is listed but
 * belongs to no payment bucket.
 */
export type PaymentCounts = Record<PaymentStatus | "all", number>;

/**
 * The usage a PLAN meters — null = unlimited for that resource.
 *
 * Branches, staff and checkout lanes are deliberately absent: they are assigned
 * to a shop, not sold on a plan, so a business opening its second site no
 * longer needs a plan minted for it.
 */
export interface PlanLimits {
  products: number | null;
  storage_mb: number | null;
  orders_month: number | null;
}

/** A payment plan: what a business pays and how much it may hold. Nothing else. */
export interface Plan {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  price: string | number;
  billing_period_months?: number;
  grace_period_days?: number;
  limits?: PlanLimits;
  is_active?: boolean;
  /** A bespoke deal for one business rather than a rung on the ladder. */
  is_custom?: boolean;
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
  grace_period_days: number;
  // Ceilings — null/omitted = unlimited.
  max_products?: number | null;
  max_storage_mb?: number | null;
  max_orders_month?: number | null;
  is_active?: boolean;
  is_custom?: boolean;
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
  /** Required on create: it sets what the business pays and its catalog ceiling. */
  plan_id?: string;
  /** The modules this shop is given. Omitted = keep its type's proposal. */
  modules?: Record<string, boolean>;
  /** Branches, staff and lanes assigned to it. Omitted = platform defaults. */
  limits?: Record<string, number | null>;
  owner: { name: string; email?: string; phone?: string; password: string };
  /**
   * The subscription window this shop is being put on. This is the only moment
   * the renewal anchor can be set correctly — every later period stacks onto
   * whatever is recorded here.
   */
  period?: BillingPeriodInput;
  /** The opening payment, if one was taken. */
  payment?: SubscriptionPaymentInput;
}

/** One module in the catalog, with what it needs switched on first. */
export interface ModuleInfo {
  key: string;
  label: string;
  description: string;
  group: string;
  depends: string[];
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
  tenants: (params: {
    search?: string;
    status?: string;
    payment_status?: PaymentStatus | "";
    page?: number;
  }) =>
    apiGet<Tenant[]>("/admin/tenants", {
      params: {
        search: params.search || undefined,
        status: params.status || undefined,
        payment_status: params.payment_status || undefined,
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
    payload: { plan_id: string; payment?: SubscriptionPaymentInput; period?: BillingPeriodInput },
  ) => apiPost<Tenant>(`/admin/tenants/${id}/assign-plan`, payload),

  /**
   * Put a locked-out shop owner back into their own business.
   *
   * Needs `tenants.reset_password`, which is deliberately NOT part of
   * `tenants.update` — this one can hand over the keys to a business, and
   * support staff who fix typos in shop addresses should not hold it. Every
   * session the owner had is destroyed server-side, and the password is never
   * echoed back in the response.
   */
  resetOwnerPassword: (
    id: string,
    payload: { password: string; password_confirmation: string; user_id?: string },
  ) => apiPost<User>(`/admin/tenants/${id}/owner-password`, payload),

  banners: () => apiGet<Banner[]>("/admin/banners"),
  createBanner: (data: FormData) => apiPost<Banner>("/admin/banners", data),
  updateBanner: (id: string, data: FormData) => apiPost<Banner>(`/admin/banners/${id}`, data),
  deleteBanner: (id: string) => apiDelete<null>(`/admin/banners/${id}`),

  announcements: () => apiGet<Announcement[]>("/admin/announcements"),
  createAnnouncement: (data: FormData) => apiPost<Announcement>("/admin/announcements", data),
  updateAnnouncement: (id: string, data: FormData) => apiPost<Announcement>(`/admin/announcements/${id}`, data),
  sendAnnouncement: (id: string) => apiPost<Announcement>(`/admin/announcements/${id}/send`),
  deleteAnnouncement: (id: string) => apiDelete<null>(`/admin/announcements/${id}`),

  moduleCatalog: () => apiGet<ModuleInfo[]>("/admin/modules"),
  updateModules: (id: string, modules: Record<string, boolean>) =>
    apiPut<Tenant>(`/admin/tenants/${id}/modules`, { modules }),

  /**
   * Set (or clear, via null) one shop's ceilings — branches and staff it was
   * assigned, or an extension past its plan on products and storage.
   *
   * `mode: "add"` treats each number as an INCREASE on the current ceiling —
   * which is what "extend by 100" means. `"set"` writes the number as the new
   * ceiling. The server refuses either one that would land below what the shop
   * already uses.
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
