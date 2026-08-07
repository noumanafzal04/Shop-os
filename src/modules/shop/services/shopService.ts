import { apiGet, apiPut } from "../../../common/api/client";
import type { Tenant } from "../../auth/types";

export interface SetupPayload {
  business_type: string;
  business_category: string;
  city_id: string;
  address?: string;
}

export interface City {
  id: string;
  name: string;
}

export interface BusinessType {
  code: string;
  label: string;
  examples: string[];
  available: boolean;
  features: Record<string, boolean>;
  default_categories: string[];
  default_expense_categories: string[];
}

export const shopService = {
  show: () => apiGet<Tenant>("/shop"),
  setup: (payload: SetupPayload) => apiPut<Tenant>("/shop/setup", payload),
  cities: () => apiGet<City[]>("/cities"),
  businessTypes: () => apiGet<BusinessType[]>("/business-types"),
};
