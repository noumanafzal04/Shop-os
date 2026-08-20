import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { couponsService, type CouponInput } from "../services/couponsService";

export function useCoupons(page = 1, search = "") {
  return useQuery({
    queryKey: ["coupons", page, search],
    queryFn: () => couponsService.list({ page, search: search || undefined }),
    placeholderData: keepPreviousData,
  });
}

export function useCouponMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["coupons"] });

  const create = useMutation({ mutationFn: (p: CouponInput) => couponsService.create(p), onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({ id, ...p }: { id: string } & Partial<CouponInput>) => couponsService.update(id, p),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => couponsService.remove(id), onSuccess: invalidate });

  return { create, update, remove };
}
