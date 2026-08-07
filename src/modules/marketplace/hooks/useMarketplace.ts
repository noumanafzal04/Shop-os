import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";
import { marketplaceService, type RegisterPayload } from "../services/marketplaceService";

export function useHomeFeed(params: { lat?: number; lng?: number; city_id?: string }) {
  return useQuery({
    queryKey: ["market", "home", params],
    queryFn: async () => (await marketplaceService.home(params)).data,
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useUniversalSearch(q: string, params: { lat?: number; lng?: number; city_id?: string }) {
  return useQuery({
    queryKey: ["market", "search", q, params],
    queryFn: async () => (await marketplaceService.search(q, params)).data,
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
}

export function useMarketShops(params: { city_id?: string; search?: string; lat?: number; lng?: number; business_type?: string }) {
  return useQuery({
    queryKey: ["market", "shops", params],
    queryFn: () => marketplaceService.shops(params),
    placeholderData: keepPreviousData,
  });
}

export function useMarketShop(slug: string | undefined, geo: { lat?: number; lng?: number } = {}) {
  return useQuery({
    queryKey: ["market", "shop", slug, geo],
    queryFn: async () => (await marketplaceService.shop(slug!, geo)).data,
    enabled: !!slug,
  });
}

export function useMarketProducts(slug: string | undefined, params: { search?: string; category_id?: string }) {
  return useQuery({
    queryKey: ["market", "products", slug, params],
    queryFn: () => marketplaceService.products(slug!, params),
    enabled: !!slug,
    placeholderData: keepPreviousData,
  });
}

export function useRegisterCustomer() {
  const setAuth = useAuthStore((s) => s.setAuth);

  return useMutation({
    mutationFn: (payload: RegisterPayload) => marketplaceService.register(payload),
    // Navigation reacts to the store flipping to authenticated-customer.
    onSuccess: async ({ data }) => {
      await setAuth(data.user, data.access_token, data.refresh_token);
    },
  });
}

export function useFavorites(enabled: boolean) {
  return useQuery({
    queryKey: ["market", "favorites"],
    queryFn: async () => (await marketplaceService.favorites()).data,
    enabled,
  });
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (slug: string) => marketplaceService.toggleFavorite(slug),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["market", "favorites"] }),
  });
}

export function useCustomerReservations(enabled: boolean) {
  return useQuery({
    queryKey: ["customer", "reservations"],
    queryFn: () => marketplaceService.reservations(),
    enabled,
  });
}

export function useReserve() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      shop_slug: string;
      product_id: string;
      variant_id?: string | null;
      quantity: number;
    }) => marketplaceService.reserve(payload),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["customer", "reservations"] }),
  });
}

export function useCancelReservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => marketplaceService.cancelReservation(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["customer", "reservations"] }),
  });
}
