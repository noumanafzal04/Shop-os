export type ItemType = "product" | "service";

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  children?: Category[];
  products_count?: number;
}

export interface ProductVariant {
  id: string;
  name: string;
  sku: string | null;
  price: string | number;
  stock_quantity: number;
}

export interface Product {
  id: string;
  type: ItemType;
  name: string;
  description: string | null;
  category_id: string | null;
  category?: { id: string; name: string } | null;
  sku: string | null;
  price: string | number;
  cost: string | number | null;
  stock_quantity: number;
  low_stock_threshold: number | null;
  track_inventory: boolean;
  duration_minutes: number | null;
  is_active: boolean;
  variants: ProductVariant[];
  created_at: string;
}

export interface ProductInput {
  type: ItemType;
  name: string;
  category_id?: string | null;
  sku?: string;
  price: string | number;
  cost?: string | number;
  stock_quantity?: number;
  low_stock_threshold?: number;
  duration_minutes?: number;
}
