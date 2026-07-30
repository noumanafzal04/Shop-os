import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { promotionsService, type PromotionInput } from "../services/promotionsService";

export function usePromotions() {
  return useQuery({
    queryKey: ["promotions"],
    queryFn: async () => (await promotionsService.list()).data,
  });
}

export function usePromotionMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["promotions"] });

  return {
    create: useMutation({ mutationFn: (p: PromotionInput) => promotionsService.create(p), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...p }: { id: string } & Partial<PromotionInput>) => promotionsService.update(id, p),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => promotionsService.remove(id), onSuccess: invalidate }),
  };
}
