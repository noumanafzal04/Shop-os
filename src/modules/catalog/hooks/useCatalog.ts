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
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}

export function useSyncModifiers(productId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groups: ModifierGroup[]) => catalogService.syncModifiers(productId!, groups),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
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

/**
 * EVERY product a deal or a recipe could name — not the first fifteen.
 *
 * The combo picker and the ingredient picker are both a plain `<select>` fed
 * from `useProducts({ search: undefined, page: 1 })`, and the products endpoint
 * pages at **fifteen** by default. So the dropdown offered fifteen items with no
 * search box, no pager, and nothing saying there were more: a restaurant writing
 * a burger recipe could pick from fifteen possible ingredients, and a shop
 * building a deal could bundle fifteen products. Everything else in the
 * catalogue was simply not in the list.
 *
 * That is the same defect class this repo has now hit nine times — a list that
 * can only ever show page one — and the pickers were invisible to the scanner
 * that hunts it, because a `<select>` full of `<option>`s is not a table with a
 * missing pager.
 *
 * A native select is the right control to keep: browsers give it type-ahead for
 * free, so a few hundred options stay navigable by keyboard. What it needed was
 * the whole list behind it.
 *
 * `enabled` is deliberate. The old call ran on every product form — its comment
 * claimed "fetched only while editing a combo" and nothing implemented that —
 * so every shopkeeper editing a plain tin of beans paid for a catalogue fetch
 * they had no use for. Now the picker's data is fetched when there is a picker.
 */
export function usePickableProducts(enabled: boolean) {
  return useQuery({
    queryKey: ["products", "pickable"],
    enabled,
    // This drains pages, so a remount that refetches costs several round trips
    // rather than one. The dine-in tab mounts it every time a waiter opens a
    // table, which is the busiest thing in the building.
    staleTime: 60_000,
    queryFn: async () => {
      const PER_PAGE = 100; // the endpoint's own ceiling
      const MAX_PAGES = 10; // 1,000 items; loud if ever reached, see below

      const first = await catalogService.products({ page: 1, per_page: PER_PAGE });
      const pages = first.meta?.pagination?.last_page ?? 1;
      const rows = [...first.data];

      for (let page = 2; page <= Math.min(pages, MAX_PAGES); page++) {
        rows.push(...(await catalogService.products({ page, per_page: PER_PAGE })).data);
      }

      return { rows, missing: pages > MAX_PAGES ? (pages - MAX_PAGES) * PER_PAGE : 0 };
    },
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
    // A product carries both halves of the reorder question — its stock and
    // its reorder level — so editing one changes what Inventory should show.
    // Setting a level and finding the list unchanged reads as a broken screen.
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
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
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
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

/**
 * Take a dish off the menu, or put it back.
 *
 * Invalidates the product list AND the till's catalog: a waiter looking at a
 * stale menu is the exact failure this feature exists to prevent, so the
 * screen that sells has to hear about it as fast as the screen that decided.
 */
export function useVariantSoldOut() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ productId, variantId, off }: { productId: string; variantId: string; off: boolean }) =>
      catalogService.setVariantSoldOut(productId, variantId, off),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["pos-catalog"] });
    },
  });
}

export function useSoldOut() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, off }: { id: string; off: boolean }) =>
      catalogService.setSoldOut(id, off),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      void qc.invalidateQueries({ queryKey: ["pos-catalog"] });
    },
  });
}
