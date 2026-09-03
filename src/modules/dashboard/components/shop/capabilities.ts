import { useCallback } from "react";

import { canVisit } from "../../../../common/routing/screenPermissions";
import { usePrimaryBusinessType } from "../../../../common/tenant/businessType";
import { useAuthStore } from "../../../../stores/authStore";

/**
 * What this shop can even HAVE — and what THIS person may open.
 *
 * The flags are read exactly the way AppSidebar reads them — a missing key is
 * OFF, never on, because a business type omits the keys it doesn't offer (a
 * pharmacy has no `dine_in`). The composite predicates mirror
 * DashboardService::forTenant one for one, so a panel is only ever drawn when
 * the server actually filled it: a books-only (finance) tenant gets no sales,
 * no stock and no pipeline instead of a grid of zeroes.
 *
 * `visit` is the second axis, and it is the one the dashboard was missing. A
 * tile is an offer to go somewhere; offering a cashier "Owed to you Rs 4,000"
 * — a figure that is the owner's business, on a screen the cashier cannot
 * open — is a promise the app then breaks. Every tile, alert row and quick
 * action is drawn only when `visit(path)` is true, using the same map the
 * sidebar filters on (screenPermissions).
 */
export interface Capabilities {
  pos: boolean;
  dineIn: boolean;
  marketplace: boolean;
  delivery: boolean;
  reservations: boolean;
  products: boolean;
  services: boolean;
  inventory: boolean;
  expenses: boolean;
  /** Sells anything at all — over the counter, at a table or online. */
  sells: boolean;
  /** Has a catalog to fill (products and/or services). */
  catalog: boolean;
  /** Carries stock, so low/out/expiring figures mean something. */
  tracksStock: boolean;
  /**
   * Keeps a SUPPLIER BOOK — orders goods, receives them, owes for them.
   *
   * Separate from `tracksStock` since Purchasing became a module a shop can
   * decline: a counter that buys from the wholesale market and puts it on the
   * shelf tracks stock perfectly well and raises no purchase order. Every
   * dashboard row that points at /tenant/suppliers or /tenant/purchases must
   * ask THIS, not `tracksStock` — those routes are gated on `purchasing`, so
   * offering them on the strength of `inventory` is a button that bounces.
   */
  buysFromSuppliers: boolean;
  /** Has an order pipeline (online orders or phone-order delivery). */
  takesOrders: boolean;
  /** Runs the Expense & Income module. */
  keepsBooks: boolean;
  /**
   * Keeps a CUSTOMER BOOK — who they are, what they owe, their points.
   *
   * Its own module since a cash-only counter can decline it, and
   * /tenant/customers is gated on it. "Does this shop sell" is not the same
   * question: a shop can sell all day and keep no khata.
   */
  keepsCustomers: boolean;
  /** The sidebar's rule for offering the Sales ledger. */
  canSell: boolean;
  businessType: string | null;
  /** May this person open that screen? Owners: always. */
  visit: (path: string) => boolean;
}

export function useCapabilities(): Capabilities {
  const features = useAuthStore(
    (s) => (s.user?.tenant as { features?: Record<string, boolean> } | null | undefined)?.features,
  );
  // Resolved, like every other trade gate on the shop side — see
  // usePrimaryBusinessType.
  const businessType = usePrimaryBusinessType();
  // Subscribe to the permission LIST rather than the store's hasPermission,
  // which is a stable closure and would leave the dashboard stale after a
  // fresh /me changed what a staff member holds.
  const role = useAuthStore((s) => s.user?.role);
  const permissions = useAuthStore((s) => s.user?.permissions);

  const visit = useCallback(
    (path: string) =>
      // Mirrors authStore.hasPermission: scope owners hold every permission.
      canVisit(path, (p) => role === "shop_owner" || (permissions?.includes(p) ?? false)),
    [role, permissions],
  );

  return capabilitiesFrom(features, businessType, visit);
}

/**
 * The same answer, without a store behind it.
 *
 * Split out so the rules can be asked a question directly. Every one of these
 * flags gates a LINK, and a link whose route is gated on a module the flag does
 * not check is a button that bounces — `offeredIsReachable.test.ts` walks every
 * module combination against the gates App.tsx actually declares, which is a
 * thing a hook needing a signed-in store cannot be made to do.
 */
export function capabilitiesFrom(
  features: Record<string, boolean> | undefined,
  businessType: string | null,
  visit: (path: string) => boolean,
): Capabilities {
  const has = (key: string) => features?.[key] ?? false;

  const pos = has("pos");
  const dineIn = has("dine_in");
  const marketplace = has("marketplace");
  const delivery = has("delivery");
  const products = has("products");
  const services = has("services");

  return {
    pos,
    dineIn,
    marketplace,
    delivery,
    reservations: has("reservations"),
    products,
    services,
    inventory: has("inventory"),
    expenses: has("expenses"),
    sells: pos || products || services || marketplace || dineIn,
    catalog: products || services,
    tracksStock: has("inventory"),
    buysFromSuppliers: has("purchasing"),
    takesOrders: delivery || marketplace,
    keepsBooks: has("expenses"),
    keepsCustomers: has("customers"),
    canSell: pos || marketplace,
    businessType,
    visit,
  };
}
