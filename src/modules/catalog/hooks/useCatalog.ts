import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { catalogService } from "../services/catalogService";
import type { CollectionInput, ModifierGroup, ProductFilters, ProductInput } from "../types";

// ── Categories ────────────────────────────────────────────────────

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await catalogService.categories()).data,
  });
}

export function useCategoryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const create = useMutation({
    mutationFn: (payload: { name: string; parent_id?: string | null }) =>
      catalogService.createCategory(payload),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string; name?: string; is_active?: boolean }) =>
      catalogService.updateCategory(id, payload),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: ({ id, reassignTo }: { id: string; reassignTo?: string }) =>
      catalogService.deleteCategory(id, reassignTo),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (rows: Array<{ id: string; parent_id: string | null; sort_order: number }>) =>
      catalogService.reorderCategories(rows),
    onSuccess: invalidate,
  });

  return { create, update, remove, reorder };
}

// ── Collections ───────────────────────────────────────────────────

export function useCollections() {
  return useQuery({
    queryKey: ["collections"],
    queryFn: async () => (await catalogService.collections()).data,
  });
}

export function useCollection(id: string | undefined) {
  return useQuery({
    queryKey: ["collections", "detail", id],
    queryFn: async () => (await catalogService.collection(id!)).data,
    enabled: !!id,
  });
}

export function useCollectionMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["collections"] });

  const create = useMutation({
    mutationFn: (payload: CollectionInput) => catalogService.createCollection(payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Partial<CollectionInput>) =>
      catalogService.updateCollection(id, payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => catalogService.deleteCollection(id),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

export function useGenerateBarcode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => catalogService.generateBarcode(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useSyncModifiers(productId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groups: ModifierGroup[]) => catalogService.syncModifiers(productId!, groups),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

// ── Item types (capability matrix) ────────────────────────────────

export function useItemTypes() {
  return useQuery({
    queryKey: ["item-types"],
    queryFn: async () => (await catalogService.itemTypes()).data,
    staleTime: 60 * 60 * 1000, // static catalog
  });
}

// ── Products ──────────────────────────────────────────────────────

export function useProducts(filters: ProductFilters) {
  return useQuery({
    queryKey: ["products", filters],
    queryFn: () => catalogService.products(filters),
    placeholderData: keepPreviousData, // table doesn't flash while paging
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ["products", "detail", id],
    queryFn: async () => (await catalogService.product(id!)).data,
    enabled: !!id,
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

  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Partial<ProductInput>) =>
      catalogService.updateProduct(id, payload),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => catalogService.deleteProduct(id),
    onSuccess: invalidate,
  });

  const importCsv = useMutation({
    mutationFn: (file: File) => catalogService.importProducts(file),
    onSuccess: invalidate,
  });

  return { create, update, remove, importCsv };
}

// ── Product images ────────────────────────────────────────────────

export function useProductImages(productId: string | undefined) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const upload = useMutation({
    mutationFn: (files: File[]) => catalogService.uploadImages(productId!, files),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (imageId: string) => catalogService.deleteImage(productId!, imageId),
    onSuccess: invalidate,
  });

  return { upload, remove };
}
