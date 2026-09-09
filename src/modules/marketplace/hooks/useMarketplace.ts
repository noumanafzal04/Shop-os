import { useEffect } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";
import {
  marketplaceService,
  type BrowseFilters,
  type ShopQuery,
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

/**
 * THE FULL LIST OF TRADES, WITH THE CATEGORIES INSIDE THEM.
 *
 * Its own query rather than a slice of the home feed: the home feed carries
 * banners, twelve deals and twenty-four shop cards, and this screen needs none
 * of it. It also answers a different question — home returns the trades that
 * have shops, this one returns every trade the platform sells.
 *
 * `staleTime` is long because the answer is a registry plus a count: the
 * registry changes when the platform grows a trade, and a count that is a
 * quarter of an hour old has never changed anybody's mind about tapping
 * Garments.
 */
export function useCategories(params: { city_id?: string } = {}) {
  return useQuery({
    queryKey: ["market", "categories", params],
    queryFn: async () => (await marketplaceService.categories(params)).data,
    staleTime: 15 * 60 * 1000,
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

/**
 * The shop list, page by page — the same reasoning as the aisle.
 *
 * Twenty a page from the server, and the app used to ask for one. A city with
 * ninety shops showed twenty and stopped, with nothing on screen to say the
 * other seventy existed.
 */
export function useMarketShops(params: ShopQuery) {
  return useInfiniteQuery({
    queryKey: ["market", "shops", params],
    queryFn: ({ pageParam }) => marketplaceService.shops({ ...params, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const p = last.meta?.pagination;
      if (p == null || p.current_page >= p.last_page) return undefined;

      return p.current_page + 1;
    },
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
 * A SHOP'S WHOLE MENU.
 *
 * ── Two bugs in one hook ─────────────────────────────────────────────
 *
 * The shop screen used `useMarketProducts`, which asks for page one and
 * nothing else. The endpoint pages at twenty — so a restaurant with a
 * thirty-item menu had ten items that could not be reached by any gesture on
 * that screen. Not "hard to reach": unreachable, and the screen gave no sign
 * there was more.
 *
 * And the category chips were a FILTER: pressing "Burgers" refetched the menu
 * with `category_id`, so the rest of it disappeared and came back over the
 * network. That is the right shape for an aisle spanning every shop and the
 * wrong one for a single menu, where the chips are a table of contents and
 * what somebody wants is to be taken to that part of it.
 *
 * ── Why the whole thing, rather than infinite scroll ─────────────────
 *
 * Because the chips have to be able to jump to a section that has not been
 * scrolled to yet. A menu is bounded — one shop, ordered by category server
 * side — so this asks for a hundred at a time and keeps going until it has all
 * of it. The first hundred render immediately; the rest fill in behind, and
 * for almost every shop there is no second request at all.
 *
 * `search` still goes to the SERVER, because it searches the whole menu rather
 * than the part that happens to be loaded.
 */
export function useShopMenu(slug: string | undefined, search?: string) {
  const query = useInfiniteQuery({
    queryKey: ["market", "menu", slug, search ?? ""],
    queryFn: ({ pageParam }) =>
      marketplaceService.productsPage(slug!, { search, page: pageParam, per_page: 100 }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const p = last.meta?.pagination;
      if (p == null || p.current_page >= p.last_page) return undefined;

      return p.current_page + 1;
    },
    enabled: !!slug,
    placeholderData: keepPreviousData,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // Keep going until the menu is complete. Guarded on `isFetchingNextPage`
  // because this effect re-runs on every page that lands, and without it the
  // second page would be requested as many times as there are renders.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return query;
}

/**
 * The aisle, filtered.
 *
 * `keepPreviousData` on purpose: changing a filter should re-sort the list
 * under the sheet, not blank it. An empty screen between two results reads as
 * "your filter matched nothing" for as long as the request takes.
 */
/**
 * THE AISLE, PAGE BY PAGE.
 *
 * ── Why this had to change ───────────────────────────────────────────
 *
 * It was a plain query fetching page one and stopping. The server has paged
 * this endpoint from the beginning — twenty-four a page, capped at sixty — and
 * the app simply never asked for page two. So a shop with four hundred items
 * had twenty-four, and the header said "24+" because the screen itself knew it
 * was not telling the truth.
 *
 * ── Why an infinite query and not a pager ────────────────────────────
 *
 * A phone list is a scroll. A page control at the bottom of a two-column grid
 * means reaching the end, tapping, and losing your place — and nobody does it
 * twice. `getNextPageParam` returns undefined at the last page, which is what
 * stops the list asking for ever.
 */
export function useBrowse(filters: BrowseFilters, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: ["market", "browse", filters],
    queryFn: ({ pageParam }) => marketplaceService.browse({ ...filters, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const p = last.meta?.pagination;
      // No pagination in the envelope means the endpoint answered in full.
      // Treating that as "there is more" would loop on the same page for ever.
      if (p == null || p.current_page >= p.last_page) return undefined;

      return p.current_page + 1;
    },
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
