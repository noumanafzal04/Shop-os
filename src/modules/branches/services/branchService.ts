import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

export interface Branch {
  id: string;
  name: string;
  code: string | null;
  /** A shop sells at a counter; a warehouse only holds stock. */
  kind: "shop" | "warehouse";
  is_default: boolean;
  is_active: boolean;
  /** May online orders be filled from here. Always true of a shop. */
  fills_orders: boolean;
  /**
   * The one place this business's deliveries come to. Marked, every new
   * purchase order starts addressed to it; with none marked, an order is
   * addressed to whoever raises it.
   */
  takes_deliveries?: boolean;
  address: string | null;
  phone: string | null;
  city_id: string | null;
  city?: { id: string; name: string } | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

export interface BranchInput {
  name: string;
  kind?: "shop" | "warehouse";
  fills_orders?: boolean;
  takes_deliveries?: boolean;
  code?: string | null;
  address?: string | null;
  phone?: string | null;
  city_id?: string | null;
  is_active?: boolean;
}

/** What is at a place that has to be decided before it can be deleted. */
export interface PlaceLeaving {
  /** Products with stock on its shelves, and how many units of them. */
  products: number;
  units: number;
  /** Staff assigned to work there. */
  people: number;
  /** Something a person has to finish first — an open till, a transfer on the road. Null when nothing is. */
  blocked: string | null;
}

/** What becomes of what is in a place being deleted. */
export interface PlaceGoing {
  /** Its stock: carried to `stock_to`, or written off with it. */
  stock?: "move" | "discard";
  stock_to?: string;
  /** Where its staff work from now on. */
  people_to?: string;
}

export const branchService = {
  list: () => apiGet<Branch[]>("/branches"),
  create: (payload: BranchInput) => apiPost<Branch>("/branches", payload),
  update: (id: string, payload: Partial<BranchInput>) => apiPut<Branch>(`/branches/${id}`, payload),
  leaving: (id: string) => apiGet<PlaceLeaving>(`/branches/${id}/leaving`),
  remove: (id: string, going: PlaceGoing = {}) => apiDelete<null>(`/branches/${id}`, { data: going }),
};
