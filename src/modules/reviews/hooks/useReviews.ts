import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";
import { reviewService } from "../services/reviewService";

/**
 * What this person has said about the shops they buy from.
 *
 * Guests never ask — the endpoint is behind `role:customer`, and a query that
 * fires for a guest is a 401 the app then has to explain away.
 */
export function useMyReviews() {
  const signedIn = useAuthStore((s) => s.status === "authenticated");

  return useQuery({
    queryKey: ["reviews", "mine"],
    queryFn: async () => (await reviewService.mine()).data,
    enabled: signedIn,
    staleTime: 30_000,
  });
}

export function useSaveReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { shop_slug: string; rating: number; comment?: string | null }) =>
      reviewService.save(payload),
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({ queryKey: ["reviews", "mine"] });
      // The shop's own page carries its rating and its published list, and
      // both just changed. Leaving them is how somebody posts a review and
      // watches the average not move.
      queryClient.invalidateQueries({ queryKey: ["market", "shop", payload.shop_slug] });
    },
  });
}

export function useDeleteReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => reviewService.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews", "mine"] });
      queryClient.invalidateQueries({ queryKey: ["market", "shop"] });
    },
  });
}
