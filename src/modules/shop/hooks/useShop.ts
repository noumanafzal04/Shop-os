import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shopService, type Shop, type ShopSettings } from "../services/shopService";

export function useShop() {
  return useQuery({
    queryKey: ["shop"],
    queryFn: async (): Promise<Shop> => (await shopService.show()).data,
    staleTime: 5 * 60_000,
  });
}

export function useShopSettings() {
  return useQuery({
    queryKey: ["shop-settings"],
    queryFn: async (): Promise<Record<string, unknown>> => (await shopService.settings()).data,
    staleTime: 5 * 60_000,
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (changes: Partial<ShopSettings>) => shopService.updateSettings(changes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shop-settings"] });
      // Delivery rules change what the marketplace shows, which the dashboard
      // summarises.
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useSaveHours() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (business_hours: Shop["business_hours"]) => shopService.update({ business_hours }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shop"] });
    },
  });
}
