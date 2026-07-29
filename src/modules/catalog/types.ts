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
  requires_prescription?: boolean;
  barcodes?: Array<{ id: string; barcode: string }>;
  unit: string | null;
  attributes: Record<string, string> | null;
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
  stock_quantity: number;
  low_stock_threshold: number | null;
  track_inventory: boolean;
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
  name: string;
  sku?: string;
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
  requires_prescription?: boolean;
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
  tax_rate?: number | string;
  track_inventory?: boolean;
  stock_quantity?: number;
  low_stock_threshold?: number;
  // Opening-lot expiry (medicines with opening stock).
  expiry_date?: string;
  duration_minutes?: number;
  available_from?: string | null;
  available_until?: string | null;
  is_active?: boolean;
  visible_in_marketplace?: boolean;
  variants?: VariantInput[];
  collection_ids?: string[];
}

export interface ProductFilters {
  search?: string;
  type?: ItemType | "";
  category_id?: string;
  low_stock?: boolean;
  page?: number;
}
