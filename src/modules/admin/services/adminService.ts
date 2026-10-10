import type { AddOnReach } from "../addOnReach";
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
 * ── Null reads two ways here, on purpose ───────────────────────────────
 *
 * On BILLED USAGE — products, storage, bills a month — null means UNLIMITED.
 * That is what a plan is for.
 *
 * On ORGANISATION SIZE — branches, staff, tills — null means THIS PLAN HAS NO
 * OPINION, and the shop falls to the platform default carried in `defaults`
 * below. Never unlimited: "however many staff accounts you like" is how a shop
 * ends up with forty and finds out in an audit.
 *
 * The asymmetry is what makes the columns safe to have added. Every plan that
 * pre-dates them holds null in all of them, so no shop's ceiling moved.
 */
export interface PlanLimits {
  products: number | null;
  storage_mb: number | null;
  orders_month: number | null;
  /** Branches this plan includes. Null = the platform default. */
  branches: number | null;
  /** Staff logins, not counting the owner. Null = the platform default. */
  staff: number | null;
  registers: number | null;
  /**
   * Whether a shop on this plan may sell with no server. 0/1, and the one
   * capability a plan gates — a module describes the SHAPE of a trade, and
   * offline selling is wanted by every trade there is.
   */
  offline_selling: number | null;
  /** How long a till may keep selling out of contact. */
  offline_days: number | null;
  /**
   * How far back a shop on this plan can look, in months. Null = no limit.
   *
   * Months and not years because "eighteen months" is a real offer. The
   * policy is RECORDED and shown; nothing is hidden by it — see the
   * migration for why enforcement is a separate decision.
   */
  retention_months: number | null;
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
  /**
   * Room past the included bills before anyone calls the number exhausted.
   * A till must never stop because of an invoice.
   */
  grace_orders_month?: number | null;
  /**
   * What a shop lands on when this plan says nothing, so an empty box on the
   * admin screen can print "1 (platform default)" rather than look broken.
   */
  defaults?: { branches: number; staff: number; registers: number };
  /**
   * The modules the plan includes, whatever the trade. A starting point and a
   * label — what a shop is switched on with, and the line between "in the
   * plan" and "an add-on". It is never what decides what a shop may use.
   */
  modules?: string[];
  /** Its own list, rather than what its rung of the ladder includes. */
  modules_own?: boolean;
}

/** What a shop of one trade is offered on one plan. */
export interface ModuleOffer {
  included: string[];
  addons: string[];
  other: string[];
  essential: string[];
  modules: Record<string, boolean>;
  /** The platform's monthly price for an add-on. A module not here is free to add. */
  prices: Record<string, number>;
  plan: { id: string; name: string; price: number; months: number } | null;
}

/** How one shop's own modules sit against its plan, and what that comes to. */
export interface TenantPackage {
  included: string[];
  addons: string[];
  /** In the plan, and switched off for this shop. */
  missing: string[];
  offer: { included: string[]; addons: string[]; other: string[] };
  bill: {
    plan: { name: string | null; price: number; months: number };
    addons: Array<{ key: string; label: string; monthly: number; listed: number | null; own_price: boolean }>;
    addons_monthly: number;
    addons_total: number;
    total: number;
  };
  own_prices: Record<string, number>;
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
  grace_orders_month?: number | null;
  max_branches?: number | null;
  max_staff?: number | null;
  max_registers?: number | null;
  max_offline_selling?: number | null;
  max_offline_days?: number | null;
  retention_months?: number | null;
  is_active?: boolean;
  is_custom?: boolean;
  /** null puts the plan back on what its rung of the ladder includes. */
  modules?: string[] | null;
}

/**
 * WHAT MOVING THIS SHOP BETWEEN PLANS WOULD DO.
 *
 * Asked before anything changes, because the dangerous half of a plan change
 * is invisible from a dropdown: an admin moving a shop from Pro to Basic is
 * thinking about the price, not about the six staff accounts that shop has
 * and the three the new plan includes.
 *
 * Nothing here refuses anything. A downgrade that leaves a shop over its new
 * ceiling is an ordinary commercial situation and the software's job is to
 * SAY SO.
 */
export interface PlanChangePreview {
  from: { id: string | null; name: string | null; price: string | number | null };
  to: { id: string; name: string; price: string | number };
  /** Signed, per billing period. Negative on a downgrade. */
  price_difference: number;
  billing_period_months: number;
  rows: PlanChangeRow[];
  /** Only the rows this shop would land over. Usually empty. */
  excess: PlanChangeRow[];
}

export interface PlanChangeRow {
  key: string;
  label: string;
  used: number;
  from: number | null;
  to: number | null;
  /** How far over the new ceiling this shop already is. 0 when it is not. */
  excess: number;
  /** Whether being over this one actually refuses anything. */
  blocks: boolean;
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
  // Nullable, because the API can return it null and this type said otherwise.
  // A force-deleted shop cascades its payment rows away, but the FK is only
  // guaranteed while the tenant row exists at all — so the honest shape admits
  // the gap and the table renders a fallback instead of a blank cell.
  tenant: { id: string | null; business_name: string | null } | null;
  plan_name: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  period_start: string;
  period_end: string;
  paid_at: string;
}

/** What one bucket of late shops is worth. `unpriced` are the shops with no
 *  plan on them yet — they owe nothing and they are the list worth having. */
export interface OutstandingBucket {
  shops: number;
  amount: number;
  unpriced: number;
}

export interface ChaseRow {
  id: string;
  business_name: string;
  phone: string | null;
  email: string | null;
  plan_name: string | null;
  amount: number | null;
  payment_status: "grace" | "unpaid";
  ends_at: string | null;
  /** Worked out on the server, so two screens can never disagree about how
   *  late somebody is. */
  days_late: number | null;
}

export interface BillingSummary {
  revenue: { this_month: number; this_year: number; all_time: number };
  subscriptions: { active: number; expiring_soon: number; expired: number; suspended: number };
  recent_payments: Array<{ tenant: string; plan_name: string; amount: string; paid_at: string }>;
  revenue_series: Array<{ month: string; ym: string; total: number }>;
  outstanding: { unpaid: OutstandingBucket; grace: OutstandingBucket; suspended: OutstandingBucket };
  chase: ChaseRow[];
}

export interface PaymentFilters {
  tenant_id?: string;
  search?: string;
  method?: string;
  from?: string | null;
  to?: string | null;
  page?: number;
}

/** Totals for the WHOLE filtered ledger, not the page on screen. */
export interface PaymentTotals {
  payments: number;
  amount: number;
}

export interface MethodSplit {
  method: string;
  payments: number;
  amount: number;
}

/** Which door a shop came in through — see Tenant::origin() on the server. */
export type TenantOrigin = "demo" | "converted" | "direct";

export type OriginCounts = Record<TenantOrigin | "all", number>;

/**
 * Every axis the tenant list can be narrowed by.
 *
 * Five of these — status, city, plan, business type, online-only — have been
 * accepted by the server since the list was written, and the screen in front
 * of it sent exactly two. An admin with four hundred shops had a search box.
 */
export interface TenantFilters {
  search?: string;
  status?: string;
  payment_status?: PaymentStatus | "";
  origin?: TenantOrigin | "";
  business_type?: string;
  city_id?: string;
  /** A plan id, or the literal "none" for shops not priced yet. */
  plan_id?: string;
  setup?: "pending" | "done" | "";
  online_only?: boolean;
  /** Only the shops that were deleted — which can be put back. */
  only_deleted?: boolean;
  sort?: string;
  page?: number;
}

export const adminService = {
  tenants: (params: TenantFilters) =>
    apiGet<Tenant[]>("/admin/tenants", {
      params: {
        search: params.search || undefined,
        status: params.status || undefined,
        payment_status: params.payment_status || undefined,
        origin: params.origin || undefined,
        business_type: params.business_type || undefined,
        city_id: params.city_id || undefined,
        plan_id: params.plan_id || undefined,
        setup: params.setup || undefined,
        // `undefined`, never `false`: the server reads this with
        // `$request->boolean()`, and sending "false" as a string is true.
        online_only: params.online_only ? true : undefined,
        sort: params.sort || undefined,
        // Deleted shops are asked for, never mixed in — see the note on the
        // server. `undefined`, never `false`, for the same reason as above.
        only_deleted: params.only_deleted ? true : undefined,
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
  updateModules: (id: string, modules: Record<string, boolean>, addonPrices?: Record<string, number>) =>
    apiPut<Tenant>(`/admin/tenants/${id}/modules`, { modules, ...(addonPrices ? { addon_prices: addonPrices } : {}) }),
  moduleOffer: (businessType: string, planId?: string) =>
    apiGet<ModuleOffer>("/admin/modules/offer", { params: { business_type: businessType, plan_id: planId || undefined } }),
  modulePrices: () => apiGet<Record<string, number>>("/admin/modules/prices"),
  /** Only the boxes that were changed — see priceChanges. A null takes a price off. */
  saveModulePrices: (changes: Record<string, number | null>) => apiPut<Record<string, number>>("/admin/modules/prices", { changes }),
  /** Where each add-on price can ever apply, and how many shops pay it today. */
  moduleReach: () => apiGet<Record<string, AddOnReach>>("/admin/modules/reach"),

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

  /**
   * CAPACITY SOLD OR GIVEN, as rows beside the assigned ceiling.
   *
   * `extendLimits` ASSIGNS the size of the organisation — this shop is a
   * three-branch business. These say what was bought on top of it, at what
   * price, and until when: the part that can be invoiced, expired, and
   * explained six months later.
   */
  /** A read-only "what would happen" — see PlanChangePreview. */
  planChange: (id: string, planId: string) =>
    apiGet<PlanChangePreview>(`/admin/tenants/${id}/plan-change`, { params: { plan_id: planId } }),

  entitlements: (id: string) => apiGet<Entitlement[]>(`/admin/tenants/${id}/entitlements`),
  grantCapacity: (id: string, body: GrantInput) =>
    apiPost<Entitlement>(`/admin/tenants/${id}/entitlements`, body),
  /** Ends it TODAY, inclusive. Never deletes — a billed grant is history. */
  endGrant: (id: string, entitlementId: string) =>
    apiDelete<Entitlement>(`/admin/tenants/${id}/entitlements/${entitlementId}`),

  plans: () => apiGet<Plan[]>("/admin/plans"),
  createPlan: (payload: PlanInput) => apiPost<Plan>("/admin/plans", payload),
  updatePlan: (id: string, payload: Partial<PlanInput>) => apiPut<Plan>(`/admin/plans/${id}`, payload),
  deletePlan: (id: string) => apiDelete<null>(`/admin/plans/${id}`),
  cities: () => apiGet<Array<{ id: string; name: string }>>("/cities"),

  payments: (params: PaymentFilters) =>
    apiGet<Payment[]>("/admin/billing/payments", {
      params: {
        tenant_id: params.tenant_id || undefined,
        search: params.search || undefined,
        method: params.method || undefined,
        from: params.from || undefined,
        to: params.to || undefined,
        page: params.page ?? 1,
      },
    }),

  billingSummary: () => apiGet<BillingSummary>("/admin/billing/summary"),

  /** How many people are waiting on a reply, for the rail's badges. Absent
   *  keys mean "you may not read that queue" — never zero. */
  inbox: () => apiGet<{ shop_requests?: number; enquiries?: number }>("/admin/inbox"),
};

/** Extra capacity on one shop: an add-on, a temporary grant, or a concession. */
export interface Entitlement {
  id: string;
  limit_key: string;
  /** The human noun for that meter, resolved by the server. */
  label: string;
  quantity: number;
  /** Per billing period. Null = no price was set; 0 = agreed free. Different. */
  unit_price: string | number | null;
  /** unit_price x quantity, or null when unpriced. */
  period_value: number | null;
  starts_on: string;
  /** Null = for ever, which is what an ordinary paid add-on is. */
  ends_on: string | null;
  note: string | null;
  /** Decided by the server so the screen and an invoice run cannot disagree. */
  state: "live" | "pending" | "expired";
}

export interface GrantInput {
  limit_key: string;
  quantity: number;
  unit_price?: number | null;
  starts_on?: string | null;
  ends_on?: string | null;
  note?: string | null;
}
