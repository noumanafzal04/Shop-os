import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

export type PriceLevel = "retail" | "wholesale";

export interface CustomerGroup {
  id: string;
  name: string;
  price_level: PriceLevel;
  discount_percent: string | number | null;
  is_active: boolean;
  customers_count?: number;
}

export interface CustomerGroupInput {
  name: string;
  price_level?: PriceLevel;
  discount_percent?: number | null;
  is_active?: boolean;
}

export const customerGroupsService = {
  list: () => apiGet<CustomerGroup[]>("/customer-groups"),
  create: (payload: CustomerGroupInput) => apiPost<CustomerGroup>("/customer-groups", payload),
  update: (id: string, payload: Partial<CustomerGroupInput>) => apiPut<CustomerGroup>(`/customer-groups/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/customer-groups/${id}`),
};
