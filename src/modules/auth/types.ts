export type UserRole =
  | "super_admin"
  | "admin_staff"
  | "shop_owner"
  | "staff"
  | "customer";

/** One row of a tenant's usage-vs-limit picture (see PlanLimits::snapshot). */
export interface LimitUsage {
  key: string;
  label: string;
  limit: number | null; // effective ceiling; null = unlimited
  /**
   * Who decides this ceiling: "plan" for billed usage (products, storage), or
   * "tenant" for the size of the organisation (branches, staff, lanes) — the
   * things an admin assigns to one shop rather than selling on a plan.
   */
  owner: "plan" | "tenant";
  /** Before anything was set for this shop: its plan, or the platform default. */
  baseline: number | null;
  /** effective − baseline. Null when either side is unlimited. */
  extra: number | null;
  /** Set on this shop specifically rather than inherited. */
  assigned: boolean;
  used: number;
  remaining: number | null;
  unlimited: boolean;
  enforced: boolean;
}

/**
 * Who has paid, who has not, who is inside the plan's grace period, and who
 * the platform has switched off. Mutually exclusive — a suspended shop is only
 * ever "suspended", whatever its dates say.
 */
export type PaymentStatus = "paid" | "grace" | "unpaid" | "suspended";

export interface Tenant {
  id: string;
  business_name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  business_category: string | null;
  city?: { id: string; name: string };
  plan?: { id: string; name: string; code: string };
  online_shop_enabled: boolean;
  features?: Record<string, boolean>;
  /** What this shop was assigned: branches, staff, lanes, plus any extension. */
  limits?: Record<string, number>;
  /** What its business type would have proposed, for comparison. */
  default_modules?: Record<string, boolean>;
  /** Live usage vs effective limit — present on the tenant detail view only. */
  limits_usage?: LimitUsage[];
  status: "active" | "suspended";
  setup_completed: boolean;
  subscription_starts_at?: string | null;
  subscription_ends_at: string | null;
  subscription_expired: boolean;
  subscription_state?: "active" | "grace" | "read_only";
  /**
   * The same lifecycle in billing words. `subscription_state` says what the
   * SOFTWARE does (read_only); this says why (unpaid), and folds in suspension,
   * which the other one does not know about. The admin list filters on this.
   */
  payment_status?: PaymentStatus;
  grace_ends_at?: string | null;
  business_type?: string | null;
  /**
   * The current type the shop's code stands for — identical to business_type
   * for every type in the picker, and the type that absorbed it for an older
   * code (clinic → pharmacy, workshop → automotive). Anything deciding what
   * the business IS reads this; business_type is what the admin chose.
   */
  business_type_primary?: string | null;
  /**
   * What THIS shop may put in its catalog — its trade crossed with its own
   * module map. Distinct from the `item_types` on /business-types, which
   * describes a type as shipped and knows nothing about a per-tenant module
   * grant. Any item-type picker must read this one.
   */
  item_types?: string[];
  logo_path: string | null;
  /** Resolved server-side — never assemble a storage URL in the client. */
  logo_url?: string | null;
  address: string | null;
  deleted_at?: string | null;
  users?: User[];
  created_at: string;
}

export interface User {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: "active" | "suspended";
  permissions: string[];
  /**
   * The branch this person is pinned to, or null.
   *
   * The server has sent this since branches existed and this type did not have
   * it, so it arrived and was dropped — which is why nothing in the panel could
   * show a staff member their branch or set one. Staff are pinned to it by
   * `ResolveBranch` and cannot move with a header; an owner's is null, because
   * an owner switches.
   */
  branch_id: string | null;
  email_verified: boolean;
  phone_verified: boolean;
  last_login_at: string | null;
  tenant?: Tenant | null;
  created_at: string;
}

export interface LoginPayload {
  identifier: string;
  password: string;
  device_name?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export type LoginResponse = AuthTokens & { user: User };
