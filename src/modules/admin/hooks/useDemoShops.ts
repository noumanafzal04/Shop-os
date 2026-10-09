import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { apiGet, apiPost } from "../../../common/api/client";
import { useToast } from "../../../components/ui/toast";

/** A shop somebody is trying. Mirrors `Admin\DemoShopController::index`. */
export interface DemoShop {
  id: string;
  business_name: string;
  business_type: string | null;
  business_type_label: string | null;
  created_at: string | null;
  demo_expires_at: string | null;
  /** Past its day and not yet cleared away. It can still be kept. */
  ended: boolean;
  products_count: number;
  sales_count: number;
  sales_total: number;
  last_sale_at: string | null;
  /** Whoever pressed "Keep this shop" and is waiting — with a sign-in of their own. */
  request: { id: string; contact_name: string; contact_email: string; contact_phone: string | null; requested_at: string | null } | null;
}

export function useDemoShops(page: number) {
  return useQuery({
    queryKey: ["admin", "demo-shops", page],
    queryFn: () => apiGet<DemoShop[]>("/admin/demo-shops", { params: { page } }),
  });
}

/**
 * EVERYTHING THAT IS WRONG THE MOMENT A DEMO BECOMES A BUSINESS.
 *
 * It was counted as a demo, and not as a shop, in six places: the two lists on
 * the Demo shops screen, the tenant list and its origin counts, the shop's own
 * page, the rail's "waiting" badge and the dashboard's figures.
 *
 * One function, because a demo becomes a business from three buttons — the
 * request queue, the list of demos being tried, and a demo's own page — and
 * three hand-written lists of what to refresh is three chances to leave one
 * screen saying "Trying it 8" about seven.
 */
export function refreshAfterADemoChanges(client: QueryClient): void {
  for (const key of ["demo-shops", "shop-requests", "tenants", "tenant", "inbox"]) {
    void client.invalidateQueries({ queryKey: ["admin", key] });
  }
  void client.invalidateQueries({ queryKey: ["dashboard"] });
}

/**
 * Say yes to somebody's own "Keep this shop". The same call from all three
 * buttons, and the same list of what it makes stale.
 *
 * What it does NOT carry is the failure. A save that fails is said by the
 * screen that asked for it — pass `failed(toast, "…")` to `mutate()` — which
 * is this panel's rule (e2e/savesSayWhenTheyFail.guard.ts), and for a reason:
 * a handler hidden in a hook is one a caller cannot see is there, and the next
 * caller adds a second.
 */
export function useApproveShopRequest() {
  const toast = useToast();
  const client = useQueryClient();

  return useMutation({
    mutationFn: (requestId: string) => apiPost<unknown>(`/admin/shop-requests/${requestId}/approve`),
    onSuccess: ({ message }) => {
      toast.success(message ?? "Approved.");
      refreshAfterADemoChanges(client);
    },
  });
}
