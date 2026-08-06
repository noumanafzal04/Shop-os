import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

/**
 * A vehicle the shop works on.
 *
 * A tyre or auto shop's real customer key. Ask one about a regular and they
 * answer with a plate, not a person — LEA-1234, the white Corolla, 195/65 R15,
 * fitted a set in March.
 */
export interface Vehicle {
  id: string;
  customer_id: string | null;
  customer?: { id: string; name: string | null; phone: string | null } | null;
  /** Stored normalised: "lea 1234", "LEA-1234" and "LEA1234" are one car. */
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  /** What it takes — written down once so nobody measures it again. */
  tyre_size: string | null;
  engine_no: string | null;
  chassis_no: string | null;
  /** Last reading seen. Service intervals are a distance, not a date. */
  odometer: number | null;
  odometer_at: string | null;
  notes: string | null;
  is_active: boolean;
}

export interface VehicleInput {
  registration: string;
  customer_id?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  colour?: string | null;
  tyre_size?: string | null;
  engine_no?: string | null;
  chassis_no?: string | null;
  odometer?: number | null;
  notes?: string | null;
  is_active?: boolean;
}

/** Everything this vehicle has ever had done to it. */
export interface VehicleHistory {
  vehicle: Vehicle;
  visits: Array<{
    id: string;
    invoice_number: string;
    status: string;
    total: string;
    odometer: number | null;
    sold_at: string;
    items: Array<{ id: string; product_name: string; variant_name: string | null; quantity: string; line_total: string }>;
  }>;
  lifetime_value: number;
  last_visit: string | null;
}

export const vehiclesService = {
  list: (params: { search?: string; customer_id?: string; per_page?: number } = {}) =>
    apiGet<Vehicle[]>("/vehicles", { params }),

  /** The till's own lookup — a cashier can find a plate without the CRM permission. */
  lookup: (search: string) => apiGet<Vehicle[]>("/vehicles-lookup", { params: { search, per_page: 10 } }),

  /** Register a plate mid-sale, from the till. */
  quickCreate: (payload: VehicleInput) => apiPost<Vehicle>("/vehicles-quick", payload),

  create: (payload: VehicleInput) => apiPost<Vehicle>("/vehicles", payload),
  update: (id: string, payload: Partial<VehicleInput>) => apiPut<Vehicle>(`/vehicles/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/vehicles/${id}`),

  history: (id: string) => apiGet<VehicleHistory>(`/vehicles/${id}/history`),
  linkCustomer: (id: string, payload: { phone: string; name?: string }) =>
    apiPost<Vehicle>(`/vehicles/${id}/link-customer`, payload),
};
