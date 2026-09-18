import { apiDelete, apiGet, apiPost, apiPut } from "@cartze/core/api/client";
import type { ApiEnvelope } from "@cartze/core/types/api";

/**
 * THE MENU, AS A SHOPKEEPER EDITS IT.
 *
 * Fields read out of `create_catalog_tables.php` and `ProductController` —
 * the server returns models, so what arrives is columns plus eager-loaded
 * relations. Only what this app draws is typed; the payload is much larger,
 * and copying all of it would be a type maintained against a file nobody here
 * edits.
 */

export interface ProductImage {
  id: string;
  /** Full URL, already resolved by the server. */
  url?: string;
  path: string;
  thumb_path: string | null;
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: string | number;
  is_active: boolean;
  /**
   * WHEN IT WENT OFF THE MENU — at THIS branch.
   *
   * Resolved per-branch by the server from `branch_sold_out` and written onto
   * the product for the reply. Null means it is on. It is deliberately not a
   * boolean: a shopkeeper asking "since when" has an answer, and one branch
   * running out never takes the item off the chain.
   */
  sold_out_at: string | null;
  stock_quantity: string | number | null;
  track_inventory: boolean;
  category_id: string | null;
  category?: { id: string; name: string } | null;
  images?: ProductImage[];
}

export interface Category {
  id: string;
  name: string;
  is_active: boolean;
}

export interface ProductQuery {
  search?: string;
  category_id?: string;
  page?: number;
}

/**
 * Both endpoints answer the same shape — `sold_out_at` is a timestamp when it
 * went off and null when it came back. ONE type rather than two, because the
 * caller switches between them and two narrower types make the union the
 * caller's problem for no benefit.
 */
export interface SoldOutReply {
  id: string;
  sold_out_at: string | null;
}

export const catalogService = {
  list: (q: ProductQuery = {}): Promise<ApiEnvelope<Product[]>> =>
    apiGet<Product[]>("/products", {
      params: {
        ...(q.search ? { search: q.search } : {}),
        ...(q.category_id ? { category_id: q.category_id } : {}),
        ...(q.page ? { page: q.page } : {}),
      },
    }),

  categories: (): Promise<ApiEnvelope<Category[]>> => apiGet<Category[]>("/categories"),

  show: (id: string): Promise<ApiEnvelope<Product>> => apiGet<Product>(`/products/${id}`),

  /**
   * A PARTIAL update — the server's rules are all `sometimes`, and the route
   * answers PUT as well as PATCH.
   *
   * `apiPut` because that is what the shared client has; the semantics that
   * matter are the server's, and it merges what it is given rather than
   * replacing the row. Sending the whole product back would mean this app has
   * to know every field it does not edit, and the first one it got wrong it
   * would silently overwrite. Price, name and active are what a phone is for;
   * the rest belongs to the panel.
   */
  update: (id: string, changes: Partial<Pick<Product, "name" | "price" | "is_active">>) =>
    apiPut<Product>(`/products/${id}`, changes),

  /**
   * OFF THE MENU, HERE.
   *
   * Idempotent on the server — a second press keeps the first time — so a
   * double tap cannot rewrite when it ran out.
   */
  markSoldOut: (id: string): Promise<ApiEnvelope<SoldOutReply>> =>
    apiPost<SoldOutReply>(`/products/${id}/sold-out`, {}),

  putBack: (id: string): Promise<ApiEnvelope<SoldOutReply>> =>
    apiDelete<SoldOutReply>(`/products/${id}/sold-out`),
};
