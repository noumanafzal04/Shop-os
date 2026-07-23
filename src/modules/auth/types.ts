export type UserRole =
  | "super_admin"
  | "admin_staff"
  | "shop_owner"
  | "staff"
  | "customer";

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
  status: "active" | "suspended";
  setup_completed: boolean;
  subscription_ends_at: string | null;
  subscription_expired: boolean;
  subscription_state?: "active" | "grace" | "read_only";
  grace_ends_at?: string | null;
  business_type?: string | null;
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
