import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { catalogService } from "../services/catalogService";
import type { ProductInput } from "../types";

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await catalogService.categories()).data,
  });
}

export function useProducts(params: { search?: string; page?: number }) {
  return useQuery({
    queryKey: ["products", params],
    queryFn: () => catalogService.products(params),
    placeholderData: keepPreviousData,
  });
}

export function useProductMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const create = useMutation({
    mutationFn: (payload: ProductInput) => catalogService.createProduct(payload),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => catalogService.deleteProduct(id),
    onSuccess: invalidate,
  });

  return { create, remove };
}
