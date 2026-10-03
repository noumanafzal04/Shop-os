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

/**
 * A SHELF THE SHOP ARRANGES FOR ITSELF — "Ramzan deals", "New in".
 *
 * Not a category. A category is what a thing IS and every item has one; a
 * collection is a grouping the shop invents and an item may be in none or
 * several. The server keeps them in separate tables for that reason, and the
 * two must never be offered as one screen with a toggle.
 */
export interface CollectionRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  visible_in_marketplace: boolean;
  /** `withCount('items')` on the server — how many products are on this shelf. */
  items_count?: number;
}

/**
 * WHAT THE SHOP MAY CATALOG — the server's list, never this app's.
 *
 * `TenantResource` ships `item_types`, computed by `BusinessTypes::itemTypesFor()`
 * — the SAME function `StoreProductRequest` validates against. Working the
 * list out here from the trade and the module map would be a second copy of
 * intricate logic, and the server's own comment records what that costs: a
 * salon granted `products` was drawn a Catalog, opened the form, and had every
 * save rejected with "this item type isn't available for your business type",
 * because one function still believed the module was off.
 *
 * So: offer what arrives, and if nothing arrives, say the shop cannot add
 * items rather than guessing that it can.
 */
export const ITEM_TYPE_LABEL: Record<string, string> = {
  food_item: "Dish",
  physical_product: "Product",
  medicine: "Medicine",
  service: "Service",
  deal: "Deal",
};

/**
 * A deal is not offerable from a phone.
 *
 * `combo_items` is required for it and is a desk job — picking components,
 * their variants and their quantities. The form would have to refuse the save
 * after the fact, which is the exact failure above wearing different clothes.
 */
export const NOT_ON_A_PHONE = ["deal"];

/**
 * ONE SIZE OF A THING — Small, Medium, Large; 250g, 500g.
 *
 * `name` and `price` are the only two the server requires, and they are the
 * only two this app sends: a SKU and a barcode per size are a desk job, and a
 * blank one posted from a phone would collide with `distinct` on the next
 * product that also left them blank.
 */
export interface NewVariant {
  name: string;
  price: string;
}

/**
 * WHICH KINDS CANNOT HAVE SIZES — read off the server's own rule.
 *
 * `StoreProductRequest`: `'variants' => [$isService || $isDeal ? 'prohibited'
 * : 'sometimes', ...]`. A form that offers a size box on a service would be
 * refused AFTER the person had typed, which is the failure this app keeps
 * being bitten by: offering what the save will reject.
 */
export const NO_SIZES = ["service", "deal"];

/**
 * WHAT THIS APP SENDS WHEN SOMETHING IS ADDED.
 *
 * Every name is the server's, read out of `StoreProductRequest`. The panel's
 * form has more — tax group, PLU code, pack sizes, recipe items, modifier
 * groups, warranty, medicine strength — and those stay on the panel on
 * purpose: they are filled in once, at a desk, and a phone form long enough to
 * hold them is a phone form nobody finishes.
 *
 * `discount_price` is what the panel calls **Sale price**. It is the same
 * field; the panel's label is the shopkeeper's word for it and this app uses
 * that word too.
 */
export interface NewProduct {
  name: string;
  price: string;
  item_type: string;
  category_id?: string | null;
  description?: string | null;
  /** The panel's "Sale price" — the struck-through price a customer sees. */
  discount_price?: string;
  /** What the shop paid. The dashboard's profit figure is built on it. */
  cost?: string;
  sku?: string;
  barcode?: string;
  brand?: string;
  track_inventory?: boolean;
  stock_quantity?: string;
  low_stock_threshold?: string;
  /** Any number of the shop's own shelves. */
  collection_ids?: string[];
  /** Omitted entirely when empty — an empty array is still an array. */
  variants?: NewVariant[];
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
  /**
   * ADD AN ITEM.
   *
   * `item_type` is required by the server and has no default worth guessing —
   * see `ITEM_TYPE_LABEL`. `price` travels as the string the field holds; the
   * server validates `numeric`, and parsing it here would only invent a
   * number for text the person can still see on screen.
   */
  create: (body: NewProduct): Promise<ApiEnvelope<Product>> =>
    apiPost<Product>("/products", body),

  /**
   * ONE PICTURE, AND IT REPLACES.
   *
   * The server takes a single file and replaces what is there — it refuses a
   * second in the same request. So this is never "add a photo" in the plural,
   * and the screen must say Replace when one already exists. The panel said
   * "Add photos" while the server appended, and somebody fixing a bad photo
   * got a second one with the bad one still first.
   */
  uploadImage: (id: string, file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    // RN's FormData takes this shape for a file; it is not a Blob.
    form.append("image", file as unknown as Blob);
    return apiPost<Product>(`/products/${id}/images`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  collections: (): Promise<ApiEnvelope<CollectionRow[]>> =>
    apiGet<CollectionRow[]>("/collections"),

  createCollection: (body: {
    name: string;
    visible_in_marketplace?: boolean;
  }): Promise<ApiEnvelope<CollectionRow>> => apiPost<CollectionRow>("/collections", body),

  updateCollection: (
    id: string,
    changes: Partial<Pick<CollectionRow, "name" | "is_active" | "visible_in_marketplace">>,
  ): Promise<ApiEnvelope<CollectionRow>> => apiPut<CollectionRow>(`/collections/${id}`, changes),

  removeCollection: (id: string): Promise<ApiEnvelope<unknown>> =>
    apiDelete<unknown>(`/collections/${id}`),

  createCategory: (name: string): Promise<ApiEnvelope<Category>> =>
    apiPost<Category>("/categories", { name }),

  renameCategory: (id: string, name: string): Promise<ApiEnvelope<Category>> =>
    apiPut<Category>(`/categories/${id}`, { name }),

  /**
   * The server soft-deletes and refuses when products still point at it —
   * that refusal is the useful answer, so it is shown rather than pre-empted
   * by a count this app would have to keep in step.
   */
  removeCategory: (id: string): Promise<ApiEnvelope<unknown>> =>
    apiDelete<unknown>(`/categories/${id}`),

  markSoldOut: (id: string): Promise<ApiEnvelope<SoldOutReply>> =>
    apiPost<SoldOutReply>(`/products/${id}/sold-out`, {}),

  putBack: (id: string): Promise<ApiEnvelope<SoldOutReply>> =>
    apiDelete<SoldOutReply>(`/products/${id}/sold-out`),
};
