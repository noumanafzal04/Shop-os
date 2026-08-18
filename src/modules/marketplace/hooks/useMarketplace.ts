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

export function useMarketProducts(slug: string | undefined, params: { search?: string; category_id?: string; page?: number }) {
  return useQuery({
    queryKey: ["market", "products", slug, params],
    queryFn: () => marketplaceService.products(slug!, params),
    enabled: !!slug,
    placeholderData: keepPreviousData,
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

export function useMyReservations(enabled: boolean) {
  return useQuery({
    queryKey: ["market", "reservations"],
    queryFn: async () => (await marketplaceService.reservations()).data,
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
