import { apiGet } from "../../../common/api/client";

/** A place stock can be at — shops first, then warehouses, as the server lists them. */
export interface StockPlace {
  id: string;
  name: string;
  kind: "shop" | "warehouse";
  is_default: boolean;
}

/** What one size of a product holds, place by place. */
export interface StockSize {
  id: string;
  name: string;
  /** place id → on hand there. A place holding none is simply absent. */
  places: Record<string, number>;
  /** Sent and not yet counted in: on a van, on nobody's shelf. */
  on_the_road: number;
  total: number;
}

/** One product: every place's figure, what is on the road, and its sizes. */
export interface StockRow {
  id: string;
  name: string;
  sku: string | null;
  low_stock_threshold: number | null;
  places: Record<string, number>;
  on_the_road: number;
  total: number;
  /** Empty for a product not sold in sizes. */
  sizes: StockSize[];
}

export interface StockByPlaceQuery {
  page?: number;
  search?: string;
  /** The place "running low here" is asked about. Default: the one being worked at. */
  at?: string;
  /** `refill`: low at that place, and held somewhere else. */
  only?: "refill";
}

export const stockByPlaceService = {
  list: ({ page = 1, search, at, only }: StockByPlaceQuery = {}) =>
    apiGet<StockRow[]>("/inventory/by-place", {
      params: { page, ...(search ? { search } : {}), ...(at ? { at } : {}), ...(only ? { only } : {}) },
    }),
};
