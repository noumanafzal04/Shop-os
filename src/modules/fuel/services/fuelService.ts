import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";

/**
 * The forecourt. A petrol pump is the one business here where the till is the
 * last thing to hear what was sold — fuel leaves through a meter whether or not
 * anybody rings it up — so everything below exists to compare two independent
 * measurements: what the meters moved, and what is left in the ground.
 *
 * Decimals arrive from the API as strings; the read models say so.
 */

export interface FuelTank {
  id: string;
  name: string;
  branch_id: string | null;
  product_id: string;
  product?: { id: string; name: string; price: string; unit: string | null };
  branch?: { id: string; name: string };
  capacity_litres: string;
  current_dip_litres: string;
  dead_stock_litres: string;
  /** Dip less the unpumpable bottom — what can actually be sold. */
  sellable_litres: number;
  /** Room left for a tanker. */
  ullage_litres: number;
  nozzles_count?: number;
  is_active: boolean;
}

export interface FuelNozzle {
  id: string;
  fuel_pump_id: string;
  fuel_tank_id: string;
  name: string;
  current_reading: string;
  is_active: boolean;
  tank?: { id: string; name: string; product_id: string };
}

export interface FuelPump {
  id: string;
  name: string;
  code: string | null;
  branch_id: string | null;
  branch?: { id: string; name: string };
  is_active: boolean;
  nozzles: FuelNozzle[];
}

export interface ForecourtReading {
  id: string;
  fuel_nozzle_id: string;
  nozzle_name: string;
  pump_name: string;
  product_name: string;
  opening_reading: string;
  closing_reading: string | null;
  test_litres: string;
  litres_sold: string;
  unit_price: string;
  value: string;
}

export interface ForecourtDip {
  id: string;
  fuel_tank_id: string;
  tank_name: string;
  opening_dip: string;
  closing_dip: string | null;
  delivered_litres: string;
  meter_litres: string;
  book_closing: string;
  variance_litres: string;
  variance_value: string;
}

export interface ForecourtShift {
  id: string;
  number: string;
  status: "open" | "closed";
  branch_id: string | null;
  branch?: { id: string; name: string };
  opened_at: string;
  closed_at: string | null;
  opened_by?: { id: string; name: string } | null;
  closed_by?: { id: string; name: string } | null;
  litres_sold: string;
  test_litres: string;
  fuel_value: string;
  pos_fuel_litres: string;
  pos_fuel_value: string;
  /** Meters minus till: fuel that left a nozzle and was never billed. */
  unbilled_litres: string;
  unbilled_value: string;
  /** Book minus dip: fuel that left the tank without crossing a meter. */
  tank_variance_litres: string;
  tank_variance_value: string;
  price_changed_during: boolean;
  notes: string | null;
  readings?: ForecourtReading[];
  dips?: ForecourtDip[];
}

export interface FuelDelivery {
  id: string;
  fuel_tank_id: string;
  tank?: { id: string; name: string };
  supplier?: { id: string; name: string } | null;
  shift?: { id: string; number: string } | null;
  invoice_number: string | null;
  tanker_number: string | null;
  invoiced_litres: string;
  dip_before: string | null;
  dip_after: string | null;
  received_litres: string;
  /** Invoiced minus received. What the station is being billed for and didn't get. */
  shortage_litres: string;
  unit_cost: string;
  total_cost: string;
  received_at: string;
  received_by?: { id: string; name: string } | null;
}

export interface FuelPriceChange {
  id: string;
  product_id: string;
  product?: { id: string; name: string };
  old_price: string;
  new_price: string;
  effective_at: string;
  reason: string | null;
  changed_by?: { id: string; name: string } | null;
}

export interface CloseShiftInput {
  readings: Array<{ fuel_nozzle_id: string; closing_reading: number; test_litres?: number }>;
  dips: Array<{ fuel_tank_id: string; closing_dip: number }>;
  notes?: string;
}

export const fuelService = {
  tanks: () => apiGet<FuelTank[]>("/fuel/tanks"),
  createTank: (body: Record<string, unknown>) => apiPost<FuelTank>("/fuel/tanks", body),
  updateTank: (id: string, body: Record<string, unknown>) => apiPut<FuelTank>(`/fuel/tanks/${id}`, body),
  deleteTank: (id: string) => apiDelete<null>(`/fuel/tanks/${id}`),

  pumps: () => apiGet<FuelPump[]>("/fuel/pumps"),
  createPump: (body: Record<string, unknown>) => apiPost<FuelPump>("/fuel/pumps", body),
  updatePump: (id: string, body: Record<string, unknown>) => apiPut<FuelPump>(`/fuel/pumps/${id}`, body),
  deletePump: (id: string) => apiDelete<null>(`/fuel/pumps/${id}`),
  createNozzle: (pumpId: string, body: Record<string, unknown>) =>
    apiPost<FuelNozzle>(`/fuel/pumps/${pumpId}/nozzles`, body),
  updateNozzle: (pumpId: string, id: string, body: Record<string, unknown>) =>
    apiPut<FuelNozzle>(`/fuel/pumps/${pumpId}/nozzles/${id}`, body),
  deleteNozzle: (pumpId: string, id: string) => apiDelete<null>(`/fuel/pumps/${pumpId}/nozzles/${id}`),

  currentShift: () => apiGet<ForecourtShift | null>("/fuel/shifts/current"),
  shifts: (params: { page?: number; status?: string }) => apiGet<ForecourtShift[]>("/fuel/shifts", { params }),
  shift: (id: string) => apiGet<ForecourtShift>(`/fuel/shifts/${id}`),
  openShift: (body: Record<string, unknown> = {}) => apiPost<ForecourtShift>("/fuel/shifts", body),
  closeShift: (id: string, body: CloseShiftInput) => apiPost<ForecourtShift>(`/fuel/shifts/${id}/close`, body),

  deliveries: (params: { page?: number } = {}) => apiGet<FuelDelivery[]>("/fuel/deliveries", { params }),
  createDelivery: (body: Record<string, unknown>) => apiPost<FuelDelivery>("/fuel/deliveries", body),

  prices: (params: { page?: number } = {}) => apiGet<FuelPriceChange[]>("/fuel/prices", { params }),
  createPrice: (body: Record<string, unknown>) => apiPost<FuelPriceChange>("/fuel/prices", body),
};
