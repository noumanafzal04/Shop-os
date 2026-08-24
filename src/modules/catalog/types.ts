export type ItemType = "product" | "service";

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  image_path?: string | null;
  sort_order: number;
  is_active: boolean;
  products_count?: number;
  children?: Category[];
}

export type ItemTypeCode = "physical_product" | "food_item" | "medicine" | "service" | "deal";

export interface ItemTypeInfo {
  code: ItemTypeCode;
  label: string;
  inventory: "required" | "optional" | "never";
  variants: boolean | "optional";
  modifiers: boolean;
  addons: boolean;
  pos: boolean | "optional";
  marketplace: boolean;
  /** Fields required before this item can sell online (image, description). */
  online_required?: string[];
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url?: string | null;
  sort_order: number;
  is_active: boolean;
  visible_in_marketplace: boolean;
  items_count?: number;
  items?: Array<{ id: string; name: string; price: string | number }>;
}

export interface CollectionInput {
  name: string;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
  visible_in_marketplace?: boolean;
  item_ids?: string[];
}

export interface ProductVariant {
  id: string;
  name: string;
  sku: string | null;
  price: string | number;
  cost: string | number | null;
  stock_quantity: number;
  low_stock_threshold: number | null;
  is_active: boolean;
}

export interface Product {
  id: string;
  type: ItemType;
  item_type: ItemTypeCode;
  name: string;
  description: string | null;
  category_id: string | null;
  category?: { id: string; name: string } | null;
  sku: string | null;
  barcode: string | null;
  plu_code: string | null;
  brand: string | null;
  generic_name: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  requires_prescription?: boolean;
  /** Regulator schedule (G / H / X …). Set = the till demands prescription details. */
  drug_schedule?: string | null;
  /** Which station cooks this — one KOT per station when an order is fired. */
  kitchen_station?: string | null;
  // Serialized retail (phones/electronics): capture a serial/IMEI per unit + warranty.
  tracks_serial?: boolean;
  warranty_months?: number | null;
  /**
   * Every code that resolves to this item.
   *
   * `variant_id` says WHICH size it is on: null means the code belongs to the
   * product as a whole (an "additional barcode"), anything else means it is
   * printed on that one size's packet. The panel had no idea the distinction
   * existed, so the moment sizes started carrying their own codes, the extra-
   * barcodes box would have listed them and saved them back as the product's —
   * quietly cutting every size loose from its own label.
   */
  barcodes?: Array<{ id: string; barcode: string; variant_id?: string | null }>;
  unit: string | null;
  /**
   * Free-form specs, plus one structured key this app writes itself.
   *
   * `attributes.variant_axes` holds the axes a shop typed to generate its sizes
   * — `[{name:"Colour",values:["Red","Blue"]}, …]` — so the grid can be reopened
   * on edit rather than showing twelve unexplained rows. Widened from
   * `Record<string,string>` for exactly that: the value is no longer always a
   * string.
   */
  attributes: Record<string, unknown> | null;
  price: string | number;
  // Per-branch override for the active operating branch (null = catalog price).
  branch_price?: string | null;
  cost: string | number | null;
  discount_price: string | number | null;
  wholesale_price: string | number | null;
  price_tiers: Array<{ min_qty: number | string; price: number | string }> | null;
  min_order_qty: number | string | null;
  sold_by: "unit" | "weight";
  tax_rate: string | number | null;
  tax_group_id: string | null;
  stock_quantity: number;
  low_stock_threshold: number | null;
  track_inventory: boolean;
  /**
   * Eighty-sixed — the kitchen has run out for now.
   *
   * Not the same as `is_active`, which is a catalog decision made once. This
   * one is made mid-shift and undone tomorrow, and the server refuses the line
   * either way (`ITEM_SOLD_OUT`); the flag is so the screen can say so before
   * a waiter has promised the dish to a table.
   */
  sold_out?: boolean;
  sold_out_at?: string | null;
  /**
   * Who this was last bought from, and what was paid.
   *
   * Only present on the reorder list. Derived from the shop's own purchase
   * history rather than stored on the product: a grocer buys sugar from
   * whoever was cheapest that week, so a single "preferred supplier" field
   * would be wrong within a month and wrong silently.
   */
  last_supplier_id?: string | null;
  last_supplier_name?: string | null;
  last_unit_cost?: number | null;
  duration_minutes: number | null;
  is_active: boolean;
  visible_in_marketplace: boolean;
  available_from: string | null;
  available_until: string | null;
  variants: ProductVariant[];
  images: ProductImage[];
  collections?: Array<{ id: string; name: string }>;
  modifier_groups?: ModifierGroup[];
  units?: ProductUnit[];
  combo_items?: ComboItemLine[];
  recipe_items?: RecipeItemLine[];
  /**
   * What one portion costs to make, from the recipe's own ingredients.
   *
   * Null means the figure cannot honestly be given — either there is no
   * recipe, or an ingredient under it has no cost. Never a partial sum: a
   * partial food cost is not a smaller cost but a wrong one, and it is wrong
   * in the direction that makes a kitchen underprice.
   */
  recipe_cost?: number | null;
  /** The ingredients stopping `recipe_cost` being computed, by name. */
  recipe_cost_missing?: string[];
  created_at: string;
}

/** One ingredient in a dish's recipe (item_type = food_item). */
export interface RecipeItemLine {
  id?: string;
  ingredient_product_id: string;
  quantity: number | string;
  ingredient?: { id: string; name: string };
}

/** One component inside a combo/deal (item_type = deal). */
export interface ComboItemLine {
  id?: string;
  component_product_id: string;
  quantity: number | string;
  component?: { id: string; name: string };
}

/** A larger pack a product can be sold in (pack-breaking): factor base units. */
export interface ProductUnit {
  id?: string;
  name: string;
  factor: number | string;
  price?: number | string | null;
  barcode?: string | null;
}

export interface ModifierOption {
  id?: string;
  name: string;
  price_delta: number | string;
  is_default?: boolean;
}

export interface ModifierGroup {
  id?: string;
  name: string;
  type: "modifier" | "addon";
  min_select: number;
  max_select: number;
  options: ModifierOption[];
}

export interface ProductImage {
  id: string;
  path: string;
  url: string | null;
  sort_order: number;
}

export interface VariantInput {
  /**
   * Present when the server already knows about this size.
   *
   * It is what lets one payload mean three things: a row WITH an id is an edit, a
   * row without is an addition, and an id that stops appearing is a retirement.
   * Before this existed variants were create-only, and `PUT /products/{id}`
   * carrying them answered 200 while discarding every one.
   */
  id?: string;
  /** Switched off = not sellable anywhere, but still countable and returnable. */
  is_active?: boolean;
  name: string;
  sku?: string;
  /** The code printed on THIS size's packet. Blank clears it. */
  barcode?: string;
  price: number | string;
  cost?: number | string;
  stock_quantity?: number;
  low_stock_threshold?: number;
}

export interface ProductInput {
  type?: ItemType;
  item_type?: ItemTypeCode;
  name: string;
  description?: string;
  category_id?: string | null;
  sku?: string;
  barcode?: string;
  plu_code?: string | null;
  brand?: string;
  generic_name?: string;
  strength?: string | null;
  dosage_form?: string | null;
  requires_prescription?: boolean;
  /** Regulator schedule (G / H / X …). Set = the till demands prescription details. */
  drug_schedule?: string | null;
  /** Which station cooks this — one KOT per station when an order is fired. */
  kitchen_station?: string | null;
  tracks_serial?: boolean;
  warranty_months?: number | null;
  barcodes?: string[];
  units?: ProductUnit[];
  combo_items?: Array<{ component_product_id: string; quantity: number }>;
  recipe_items?: Array<{ ingredient_product_id: string; quantity: number }>;
  unit?: string;
  attributes?: Record<string, string>;
  price: number | string;
  cost?: number | string;
  discount_price?: number | string | null;
  wholesale_price?: number | string | null;
  price_tiers?: Array<{ min_qty: number | string; price: number | string }>;
  min_order_qty?: number | string | null;
  sold_by?: "unit" | "weight";
  tax_rate?: number | string | null;
  tax_group_id?: string | null;
  track_inventory?: boolean;
  sold_out?: boolean;
  sold_out_at?: string | null;
  stock_quantity?: number;
  low_stock_threshold?: number;
  // Opening-lot expiry + batch number (medicines with opening stock).
  expiry_date?: string;
  opening_batch_number?: string;
  duration_minutes?: number;
  available_from?: string | null;
  available_until?: string | null;
  is_active?: boolean;
  visible_in_marketplace?: boolean;
  variants?: VariantInput[];
  /** The axes those variants came from. Stored inside `attributes` by the server. */
  variant_axes?: Array<{ name: string; values: string[] }>;
  collection_ids?: string[];
}

export interface ProductFilters {
  search?: string;
  type?: ItemType | "";
  category_id?: string;
  low_stock?: boolean;
  page?: number;
  /** Server caps this at 100; omitted means the API's own default of 15. */
  per_page?: number;
}
