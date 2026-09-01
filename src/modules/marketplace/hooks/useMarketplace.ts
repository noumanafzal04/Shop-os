import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useAuthStore } from "../../../stores/authStore";
import {
  marketplaceService,
  type AddressPayload,
  type AisleFilters,
  type RegisterPayload,
} from "../services/marketplaceService";

export function useBanners() {
  return useQuery({
    queryKey: ["market-banners"],
    queryFn: async () => (await marketplaceService.banners()).data,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMarketShops(params: { city_id?: string; search?: string; page?: number }) {
  return useQuery({
    queryKey: ["market", "shops", params],
    queryFn: () => marketplaceService.shops(params),
    placeholderData: keepPreviousData,
  });
}

export function useMarketShop(slug: string | undefined) {
  return useQuery({
    queryKey: ["market", "shop", slug],
    queryFn: async () => (await marketplaceService.shop(slug!)).data,
    enabled: !!slug,
  });
}


/**
 * THE AISLE — every shop's shelves at once, narrowed by whatever is asked.
 *
 * `keepPreviousData` because the filter rail is used by clicking, and a grid
 * that empties to a spinner between every click makes the page feel like it is
 * reloading rather than filtering. The old rows stay, dimmed by the caller,
 * until the new ones arrive.
 */
export function useAisle(filters: AisleFilters) {
  return useQuery({
    queryKey: ["market", "aisle", filters],
    queryFn: () => marketplaceService.browse(filters),
    placeholderData: keepPreviousData,
  });
}

/**
 * The counts beside the rail's options.
 *
 * Keyed WITHOUT page or sort, matching what the service strips — neither
 * changes which options exist, and leaving them in the key would refetch every
 * option count each time somebody turned a page.
 */
export function useAisleFacets(filters: AisleFilters) {
  const { page: _page, per_page: _perPage, sort: _sort, ...axes } = filters;

  return useQuery({
    queryKey: ["market", "facets", axes],
    queryFn: async () => (await marketplaceService.facets(axes)).data,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}

export function useMarketProduct(id: string | undefined) {
  return useQuery({
    queryKey: ["market", "product", id],
    queryFn: async () => (await marketplaceService.product(id!)).data,
    enabled: !!id,
  });
}

export function useRegisterCustomer() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (payload: RegisterPayload) => marketplaceService.register(payload),
    onSuccess: ({ data }) => {
      setAuth(data.user, data.access_token, data.refresh_token);
      navigate("/", { replace: true });
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

export function useShopReviews(slug: string | undefined) {
  return useQuery({
    queryKey: ["market", "reviews", slug],
    queryFn: () => marketplaceService.reviews(slug!),
    enabled: !!slug,
  });
}

const MY_REVIEWS = ["market", "my-reviews"];

/**
 * The reviews I wrote — the only way a screen can point at one and call it mine.
 *
 * `enabled` rather than an early return, for the same reason as the addresses
 * below: a signed-out visitor reading a shop page must not fire a call that can
 * only 401. They see the plain "sign in to review" box and nothing is missing
 * to them.
 */
export function useMyReviews(enabled: boolean) {
  return useQuery({
    queryKey: MY_REVIEWS,
    queryFn: async () => (await marketplaceService.myReviews()).data,
    enabled,
  });
}

export function useSubmitReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { shop_slug: string; rating: number; comment?: string }) =>
      marketplaceService.submitReview(payload),
    onSuccess: (_, { shop_slug }) => {
      queryClient.invalidateQueries({ queryKey: ["market", "reviews", shop_slug] });
      queryClient.invalidateQueries({ queryKey: ["market", "shop", shop_slug] });
      queryClient.invalidateQueries({ queryKey: MY_REVIEWS });
    },
  });
}

export function useDeleteReview(shopSlug: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => marketplaceService.deleteReview(id),
    onSuccess: () => {
      // The shop's own rating is an average over these, so it moves too.
      queryClient.invalidateQueries({ queryKey: ["market", "reviews", shopSlug] });
      queryClient.invalidateQueries({ queryKey: ["market", "shop", shopSlug] });
      queryClient.invalidateQueries({ queryKey: MY_REVIEWS });
    },
  });
}

// ── The buyer's saved places ──────────────────────────────────────────
//
// `enabled` rather than an early return, because a signed-out visitor browsing
// a shop must not fire a call that can only 401. They see the plain address box
// and nothing is missing to them.

const ADDRESSES = ["market", "addresses"];

export function useAddresses(enabled: boolean) {
  return useQuery({
    queryKey: ADDRESSES,
    queryFn: async () => (await marketplaceService.addresses()).data,
    enabled,
  });
}

export function useSaveAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AddressPayload) => marketplaceService.saveAddress(payload),
    // The whole list, not just the new row: saving a default clears the old
    // one on the server, so a local insert would leave two showing as default.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADDRESSES }),
  });
}

export function useDeleteAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => marketplaceService.deleteAddress(id),
    // Same reason: deleting the default promotes another one server-side.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADDRESSES }),
  });
}

// ── The buyer's own reservations ──────────────────────────────────────

export function useMyReservations(enabled: boolean, page = 1) {
  return useQuery({
    queryKey: ["market", "reservations", page],
    // The WHOLE envelope, not `.data`. Unwrapping it here threw away
    // `meta.pagination`, which is the only thing that can tell the screen there
    // is a second page — so the screen could not have offered one even if
    // somebody had thought to.
    queryFn: () => marketplaceService.reservations(page),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCancelReservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => marketplaceService.cancelReservation(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["market", "reservations"] }),
  });
}
