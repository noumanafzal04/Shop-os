import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import type { Category, Product, ProductInput } from "../types";

export const catalogService = {
  categories: () => apiGet<Category[]>("/categories"),

  products: (params: { search?: string; page?: number; type?: string }) =>
    apiGet<Product[]>("/products", {
      params: {
        search: params.search || undefined,
        type: params.type || undefined,
        page: params.page ?? 1,
      },
    }),

  product: (id: string) => apiGet<Product>(`/products/${id}`),

  createProduct: (payload: ProductInput) => apiPost<Product>("/products", payload),

  updateProduct: (id: string, payload: Partial<ProductInput>) =>
    apiPut<Product>(`/products/${id}`, payload),

  deleteProduct: (id: string) => apiDelete<null>(`/products/${id}`),
};
