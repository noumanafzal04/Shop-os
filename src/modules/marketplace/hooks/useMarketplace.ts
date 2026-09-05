import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";
import {
  marketplaceService,
  type BrowseFilters,
  type RegisterPayload,
} from "../services/marketplaceService";

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

/**
 * The aisle, filtered.
 *
 * `keepPreviousData` on purpose: changing a filter should re-sort the list
 * under the sheet, not blank it. An empty screen between two results reads as
 * "your filter matched nothing" for as long as the request takes.
 */
export function useBrowse(filters: BrowseFilters, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["market", "browse", filters],
    queryFn: () => marketplaceService.browse(filters),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

/**
 * The counts beside each option, and the price slider's real bounds.
 *
 * Driven by the sheet's DRAFT filters rather than the applied ones, so the
 * numbers answer "what would I get" while somebody is still deciding — which
 * is the only moment they are useful.
 */
export function useFacets(filters: BrowseFilters, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["market", "facets", filters],
    queryFn: async () => (await marketplaceService.facets(filters)).data,
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}

/** The cities the marketplace delivers in, optionally narrowed by name. */
export function useCities(q: string) {
  return useQuery({
    queryKey: ["market", "cities", q.trim()],
    queryFn: async () => (await marketplaceService.cities(q)).data,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60 * 1000,
  });
}

/** One product by id — the destination of a shared product link. */
export function useMarketProduct(id: string | undefined) {
  return useQuery({
    queryKey: ["market", "product", id],
    queryFn: async () => (await marketplaceService.product(id!)).data,
    enabled: !!id,
  });
}

export function useRegisterCustomer() {
  const setAuth = useAuthStore((s) => s.setAuth);

  return useMutation({
    // Reported by the screen itself — the sign-up form marks the field that is wrong — so the global
    // toast would say the same thing twice, in two shapes, one of
    // them floating over the form the person is still reading.
    // See `queryClient.ts`.
    meta: { silent: true },
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
    // Reported by the screen itself — the shop screen answers with an Alert naming the item — so the global
    // toast would say the same thing twice, in two shapes, one of
    // them floating over the form the person is still reading.
    // See `queryClient.ts`.
    meta: { silent: true },
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
