import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useAuthStore } from "../../../stores/authStore";
import { shopService, type SetupPayload, type ShopSettings } from "../services/shopService";

export function useShopSettings() {
  // /shop/settings is owner/staff-only — don't fire it for admins or customers
  // (it would 403). Other roles just get the default formatting.
  const role = useAuthStore((s) => s.user?.role);
  const isShop = role === "shop_owner" || role === "staff";
  return useQuery({
    queryKey: ["shop-settings"],
    queryFn: async () => (await shopService.settings()).data,
    staleTime: 5 * 60 * 1000,
    enabled: isShop,
  });
}

/**
 * A currency formatter bound to the tenant's configured symbol (settings →
 * currency_symbol, default "Rs"). Use everywhere money is shown so a shop that
 * sets AED/₹/$ sees it consistently. Returns a stable `money(n)` function.
 */
export function useMoney() {
  const settings = useShopSettings();
  const symbol = settings.data?.currency_symbol ?? "Rs";

  return (n: string | number) => `${symbol} ${Number(n).toLocaleString()}`;
}

export function useUpdateShopSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<ShopSettings>) => shopService.updateSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shop-settings"] });
      // Refresh the persisted session too — the sidebar/shell reads
      // tenant info from the auth store, not shop-settings, so it would
      // otherwise stay stale until the next full load.
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

export function useGallery() {
  return useQuery({
    queryKey: ["shop-gallery"],
    queryFn: async () => (await shopService.gallery()).data,
  });
}

export function useGalleryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["shop-gallery"] });
  const upload = useMutation({ mutationFn: (files: File[]) => shopService.uploadGallery(files), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => shopService.deleteGalleryImage(id), onSuccess: invalidate });
  return { upload, remove };
}

export function useCities() {
  return useQuery({
    queryKey: ["cities"],
    queryFn: async () => (await shopService.cities()).data,
    staleTime: 10 * 60 * 1000, // cities barely change
  });
}

export function useBusinessTypes() {
  return useQuery({
    queryKey: ["business-types"],
    queryFn: async () => (await shopService.businessTypes()).data,
    staleTime: 30 * 60 * 1000, // static catalog
  });
}

export function useSubscription() {
  return useQuery({
    queryKey: ["shop", "subscription"],
    queryFn: async () => (await shopService.subscription()).data,
  });
}

export function useCompleteSetup() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore.getState();

  return useMutation({
    mutationFn: (payload: SetupPayload) => shopService.setup(payload),
    onSuccess: ({ data: tenant }) => {
      // Keep the cached user's tenant in sync so the setup gate opens.
      if (user) setUser({ ...user, tenant });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate("/tenant", { replace: true });
    },
  });
}
