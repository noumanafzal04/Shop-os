export type UserRole =
  | "super_admin"
  | "admin_staff"
  | "shop_owner"
  | "staff"
  | "customer";

/**
 * The shop, as `/auth/me` returns it.
 *
 * This carries everything the app needs to decide its own shape — the module
 * map, the trade and the limits — so the whole navigation tree is computable
 * from one call. Keep it in step with `TenantResource` on the backend; the
 * fields below marked "gates" are load-bearing, not metadata.
 */
export interface Tenant {
  id: string;
  business_name: string;
  slug: string;
  email: string | null;
  phone: string | null;

  /** The raw code the admin chose. For DISPLAY only. */
  business_type: string | null;
  /**
   * GATE. The current type this shop's code stands for — an older code
   * (clinic, workshop, grocery) resolves to the type that absorbed it.
   * Anything deciding what the business IS reads this, never `business_type`.
   */
  business_type_primary: string | null;
  business_category: string | null;

  /** GATE. The per-tenant module map: `{ pos: true, expenses: true, … }`. */
  features: Record<string, boolean>;
  /** What this shop's type would have proposed, for reference. */
  default_modules?: Record<string, boolean>;
  /** GATE. What this shop may put in its catalog — trade × module map. */
  item_types: string[];
  /** Branches, staff and lanes this shop was assigned. */
  limits: Record<string, number>;

  city?: { id: string; name: string };
  plan?: { id: string; name: string; code: string };
  online_shop_enabled: boolean;
  images_enabled?: boolean;
  delivery_fee?: string | number | null;

  status: "active" | "suspended";
  setup_completed: boolean;
  subscription_ends_at: string | null;
  subscription_expired: boolean;
  /** GATE. active | grace | expired — drives the billing wall. */
  subscription_state?: string;
  grace_ends_at?: string | null;

  logo_path: string | null;
  /** Resolved server-side. Never assemble a storage URL on the client. */
  logo_url?: string | null;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  business_hours?: unknown;
  created_at: string;
}

export interface User {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: "active" | "suspended";
  /** GATE. Every screen and action is gated on these, never on `role`. */
  permissions: string[];
  /** The branch a staff member is pinned to. null = all, for owners. */
  branch_id: string | null;
  /** Whether a till PIN exists. Never the PIN itself. */
  has_till_pin?: boolean;
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
