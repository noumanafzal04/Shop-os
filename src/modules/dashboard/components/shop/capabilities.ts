import { usePrimaryBusinessType } from "../../../../common/tenant/businessType";
import { useAuthStore } from "../../../../stores/authStore";

/**
 * What this shop can even HAVE.
 *
 * The flags are read exactly the way AppSidebar reads them — a missing key is
 * OFF, never on, because a business type omits the keys it doesn't offer (a
 * pharmacy has no `dine_in`). The composite predicates mirror
 * DashboardService::forTenant one for one, so a panel is only ever drawn when
 * the server actually filled it: a books-only (finance) tenant gets no sales,
 * no stock and no pipeline instead of a grid of zeroes.
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
  /** Has an order pipeline (online orders or phone-order delivery). */
  takesOrders: boolean;
  /** Runs the Expense & Income module. */
  keepsBooks: boolean;
  /** The sidebar's rule for offering the Sales ledger. */
  canSell: boolean;
  businessType: string | null;
}

export function useCapabilities(): Capabilities {
  const features = useAuthStore(
    (s) => (s.user?.tenant as { features?: Record<string, boolean> } | null | undefined)?.features,
  );
  // Resolved, like every other trade gate on the shop side — see
  // usePrimaryBusinessType.
  const businessType = usePrimaryBusinessType();

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
    takesOrders: delivery || marketplace,
    keepsBooks: has("expenses"),
    canSell: pos || marketplace,
    businessType,
  };
}
