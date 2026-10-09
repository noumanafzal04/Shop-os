import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import type {
  Category,
  Collection,
  CollectionInput,
  ItemTypeInfo,
  ModifierGroup,
  Product,
  ProductFilters,
  ProductInput,
} from "../types";
import type { ImportSummary } from "../importFile";

export const catalogService = {
  // ── Categories ──────────────────────────────────────────────────
  categories: () => apiGet<Category[]>("/categories"),

  createCategory: (payload: { name: string; parent_id?: string | null }) =>
    apiPost<Category>("/categories", payload),

  updateCategory: (id: string, payload: Partial<Pick<Category, "name" | "parent_id" | "is_active">>) =>
    apiPut<Category>(`/categories/${id}`, payload),

  deleteCategory: (id: string, reassignTo?: string) =>
    apiDelete<null>(`/categories/${id}`, {
      params: reassignTo ? { reassign_to: reassignTo } : undefined,
    }),

  reorderCategories: (rows: Array<{ id: string; parent_id: string | null; sort_order: number }>) =>
    apiPost<null>("/categories/reorder", { categories: rows }),

  // ── Collections ─────────────────────────────────────────────────
  collections: () => apiGet<Collection[]>("/collections"),
  collection: (id: string) => apiGet<Collection>(`/collections/${id}`),
  createCollection: (payload: CollectionInput) => apiPost<Collection>("/collections", payload),
  updateCollection: (id: string, payload: Partial<CollectionInput>) =>
    apiPut<Collection>(`/collections/${id}`, payload),
  deleteCollection: (id: string) => apiDelete<null>(`/collections/${id}`),

  // ── Item types (capability matrix) ──────────────────────────────
  itemTypes: () => apiGet<ItemTypeInfo[]>("/item-types"),

  // ── Products / services ────────────────────────────────────────
  products: (filters: ProductFilters) =>
    apiGet<Product[]>("/products", {
      params: {
        search: filters.search || undefined,
        type: filters.type || undefined,
        category_id: filters.category_id || undefined,
        low_stock: filters.low_stock ? 1 : undefined,
        page: filters.page ?? 1,
        per_page: filters.per_page || undefined,
      },
    }),

  product: (id: string) => apiGet<Product>(`/products/${id}`),

  // Serial units on record for a product (POS serial picker: in_stock by default).
  serials: (id: string, status: "in_stock" | "sold" | "all" = "in_stock") =>
    apiGet<Array<{ id: string; serial: string; status: string }>>(`/products/${id}/serials`, { params: { status } }),

  createProduct: (payload: ProductInput) => apiPost<Product>("/products", payload),

  updateProduct: (id: string, payload: Partial<ProductInput>) =>
    apiPut<Product>(`/products/${id}`, payload),

  deleteProduct: (id: string) => apiDelete<null>(`/products/${id}`),

  generateBarcode: (id: string) =>
    apiPost<{ id: string; name: string; barcode: string }>(`/products/${id}/barcode`),

  /**
   * Eighty-six: off the menu for now, back on when the delivery lands.
   *
   * Deliberately not `updateProduct({ sold_out: true })`. A product PUT is a
   * catalog edit — it validates thirty fields, writes an audit row about a
   * catalog change, and would let a half-filled form take a dish off. This is
   * a service call with one meaning and no payload.
   */
  setSoldOut: (id: string, off: boolean) =>
    off
      ? apiPost<{ id: string; sold_out_at: string | null }>(`/products/${id}/sold-out`)
      : apiDelete<{ id: string; sold_out_at: string | null }>(`/products/${id}/sold-out`),

  /**
   * ONE SIZE off, rather than the whole thing.
   *
   * A kitchen runs out of large bases, not of pizza. Taking the product off
   * costs the Small and Medium sales for the rest of the evening, on the busiest
   * item on the menu.
   */
  setVariantSoldOut: (productId: string, variantId: string, off: boolean) =>
    off
      ? apiPost<{ id: string; sold_out_at: string | null }>(`/products/${productId}/variants/${variantId}/sold-out`)
      : apiDelete<{ id: string; sold_out_at: string | null }>(`/products/${productId}/variants/${variantId}/sold-out`),

  syncModifiers: (id: string, groups: ModifierGroup[]) =>
    apiPut<Product>(`/products/${id}/modifier-groups`, { groups }),

  // ── Product images (multipart) ─────────────────────────────────
  uploadImages: (productId: string, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("images[]", f));
    return apiPost<Product>(`/products/${productId}/images`, fd);
  },

  deleteImage: (productId: string, imageId: string) =>
    apiDelete<Product>(`/products/${productId}/images/${imageId}`),

  // ── Bulk import (Excel or CSV) ─────────────────────────────────
  /**
   * `dryRun` is the check: the same import, run and undone. `categories` and
   * `mapping` are what somebody answered on that check. Both go as JSON text —
   * they sit beside a file in a form, and a category's name is not a safe
   * thing to use as a form field's name.
   */
  importProducts: ({ file, dryRun, categories, mapping }: ImportRequest) => {
    const fd = new FormData();
    fd.append("file", file);
    if (dryRun) fd.append("dry_run", "1");
    if (categories && categories.length > 0) fd.append("categories", JSON.stringify(categories));
    if (mapping && Object.keys(mapping).length > 0) fd.append("mapping", JSON.stringify(mapping));
    return apiPost<ImportSummary>("/products/import", fd);
  },
};

export interface ImportRequest {
  file: File;
  dryRun?: boolean;
  categories?: Array<{ name: string; action: string; id?: string }>;
  /** A heading in the file → the field it means ("" to leave it out). */
  mapping?: Record<string, string>;
}
