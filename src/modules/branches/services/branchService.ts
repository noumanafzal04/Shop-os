import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

export interface Branch {
  id: string;
  name: string;
  code: string | null;
  is_default: boolean;
  is_active: boolean;
  address: string | null;
  phone: string | null;
  city_id: string | null;
  city?: { id: string; name: string } | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

export interface BranchInput {
  name: string;
  code?: string | null;
  address?: string | null;
  phone?: string | null;
  city_id?: string | null;
  is_active?: boolean;
}

export const branchService = {
  list: () => apiGet<Branch[]>("/branches"),
  create: (payload: BranchInput) => apiPost<Branch>("/branches", payload),
  update: (id: string, payload: Partial<BranchInput>) => apiPut<Branch>(`/branches/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/branches/${id}`),
};
