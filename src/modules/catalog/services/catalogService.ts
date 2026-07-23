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
      },
    }),

  product: (id: string) => apiGet<Product>(`/products/${id}`),

  createProduct: (payload: ProductInput) => apiPost<Product>("/products", payload),

  updateProduct: (id: string, payload: Partial<ProductInput>) =>
    apiPut<Product>(`/products/${id}`, payload),

  deleteProduct: (id: string) => apiDelete<null>(`/products/${id}`),

  generateBarcode: (id: string) =>
    apiPost<{ id: string; name: string; barcode: string }>(`/products/${id}/barcode`),

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

  // ── Bulk CSV import ────────────────────────────────────────────
  importProducts: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiPost<ImportSummary>("/products/import", fd);
  },
  importTemplateUrl: "/products/import/template",
};

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ row: number; messages: string[] }>;
}
