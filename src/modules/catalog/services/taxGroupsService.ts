import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

export interface TaxGroup {
  id: string;
  name: string;
  rate: string | number;
  is_active: boolean;
  products_count?: number;
}

export interface TaxGroupInput {
  name: string;
  rate: number;
  is_active?: boolean;
}

export const taxGroupsService = {
  list: () => apiGet<TaxGroup[]>("/tax-groups"),
  create: (payload: TaxGroupInput) => apiPost<TaxGroup>("/tax-groups", payload),
  update: (id: string, payload: Partial<TaxGroupInput>) => apiPut<TaxGroup>(`/tax-groups/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/tax-groups/${id}`),
};
