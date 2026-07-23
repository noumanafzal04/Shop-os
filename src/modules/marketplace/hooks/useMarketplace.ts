import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useAuthStore } from "../../../stores/authStore";
import { marketplaceService, type RegisterPayload } from "../services/marketplaceService";

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

export function useSubmitReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { shop_slug: string; rating: number; comment?: string }) =>
      marketplaceService.submitReview(payload),
    onSuccess: (_, { shop_slug }) => {
      queryClient.invalidateQueries({ queryKey: ["market", "reviews", shop_slug] });
      queryClient.invalidateQueries({ queryKey: ["market", "shop", shop_slug] });
    },
  });
}
