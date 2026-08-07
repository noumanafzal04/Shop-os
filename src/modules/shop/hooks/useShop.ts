import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../../../stores/authStore";
import { shopService, type SetupPayload } from "../services/shopService";

export function useCities() {
  return useQuery({
    queryKey: ["cities"],
    queryFn: async () => (await shopService.cities()).data,
    staleTime: 10 * 60 * 1000,
  });
}

export function useBusinessTypes() {
  return useQuery({
    queryKey: ["business-types"],
    queryFn: async () => (await shopService.businessTypes()).data,
    staleTime: 30 * 60 * 1000,
  });
}

export function useCompleteSetup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: SetupPayload) => shopService.setup(payload),
    onSuccess: ({ data: tenant }) => {
      // Sync the cached user's tenant — navigation reacts and unlocks Home.
      const { user, setUser } = useAuthStore.getState();
      if (user) setUser({ ...user, tenant });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
