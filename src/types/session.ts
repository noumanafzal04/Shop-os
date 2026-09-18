/**
 * WHO IS SIGNED IN, AND WHAT THEIR SHOP IS.
 *
 * Written from `UserResource` and `TenantResource` on the server rather than
 * guessed — every field below exists there. Only what this app READS is
 * listed: a resource has more, and copying all of it would mean a type that
 * has to be maintained against a file nobody here edits.
 */

/** What the shop may do. Read by `tabsFor` and by every screen that writes. */
export interface Tenant {
  id: string;
  business_name: string;
  business_type: string | null;
  business_type_primary: string | null;
  online_shop_enabled: boolean;
  setup_completed: boolean;
  status: string;
  images_enabled: boolean;
  /** Module switches — `features.pos`, `features.delivery`, and so on. */
  features: Record<string, boolean>;
  city?: { id: string; name: string } | null;
  plan?: { id: string; name: string; code: string } | null;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  branch_id: string | null;
  /**
   * WHAT THIS PERSON MAY DO — the list, not a role.
   *
   * There are no job roles in this product: cashier, waiter and kitchen are
   * permission SETS. A screen asks whether a permission is present, never who
   * somebody is.
   */
  permissions: string[];
  tenant?: Tenant | null;
}

/** What `POST /auth/login` returns, flattened by the controller. */
export interface LoginPayload {
  user: SessionUser;
  access_token: string;
  refresh_token: string;
}
