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
  subscription_ends_at: string | null;
  subscription_expired: boolean;
  subscription_state?: "active" | "grace" | "read_only";
  grace_ends_at?: string | null;
  business_type?: string | null;
  /**
   * The current type the shop's code stands for — identical to business_type
   * for every type in the picker, and the type that absorbed it for an older
   * code (clinic → pharmacy, workshop → automotive). Anything deciding what
   * the business IS reads this; business_type is what the admin chose.
   */
  business_type_primary?: string | null;
  logo_path: string | null;
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
