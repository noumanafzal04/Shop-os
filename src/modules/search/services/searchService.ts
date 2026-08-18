import { apiGet } from "../../../common/api/client";

export type SearchType = "product" | "customer" | "sale" | "order" | "supplier";

export interface ProductHit {
  id: string;
  name: string;
  sku: string | null;
  price: string | number;
  item_type: string;
  stock_quantity: number | null;
}
export interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
  credit_balance: string | number;
}
export interface SaleHit {
  id: string;
  invoice_number: string;
  /** The `OFF-…` slip printed at the till when there was no server. */
  offline_number?: string | null;
  customer_name: string | null;
  total: string | number;
  status: string;
  sold_at: string;
}
export interface OrderHit {
  id: string;
  order_number: string;
  customer_name: string;
  total: string | number;
  status: string;
  placed_at: string;
}
export interface SupplierHit {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
}

export type SearchHit = ProductHit | CustomerHit | SaleHit | OrderHit | SupplierHit;

export interface SearchGroup {
  type: SearchType;
  label: string;
  items: SearchHit[];
}

export interface SearchResults {
  query: string;
  total: number;
  groups: SearchGroup[];
}

export const searchService = {
  query: (q: string) => apiGet<SearchResults>("/search", { params: { q } }),
};
