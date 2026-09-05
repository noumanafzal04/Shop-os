import { apiGet, apiPost } from "../../../common/api/client";

/**
 * The rider half of the app.
 *
 * A rider is a CUSTOMER who was approved — one account, two hats — so every
 * call here goes out on the same token the shopping side uses. What separates
 * a rider from everybody else is a profile on the server, and `me()` answers
 * for people who have never applied without failing.
 */

export type RiderStatus = "draft" | "pending" | "approved" | "rejected" | "suspended";
export type VehicleType = "bike" | "cycle" | "car" | "van";
export type JobStage = "offered" | "to_pickup" | "on_the_way" | "delivered";

export interface RiderDocument {
  id: string;
  type: string;
  label: string;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  uploaded_at: string | null;
}

export interface RiderProfile {
  id: string;
  /** The id a human says out loud — a shop types it to add you. */
  rider_code: string;
  status: RiderStatus;
  status_label: string;
  can_ride: boolean;
  can_submit: boolean;
  vehicle_type: VehicleType;
  vehicle_registration: string | null;
  cnic_last4: string | null;
  is_platform: boolean;
  city: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  applied_at: string | null;
  approved_at: string | null;
  review_note: string | null;
  missing_documents: string[];
  required_documents: { type: string; label: string }[];
  documents: RiderDocument[];
}

export interface RiderJob {
  id: string;
  order_number: string;
  status: string;
  shop: {
    name: string | null;
    branch: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  drop_area: string | null;
  items_count: number | null;
  order_total: number;
  delivery_fee: number;
  payment_method: string;
  cash_to_collect: number;
  pickup_distance_km: number | null;
  drop_distance_km: number | null;
  placed_at: string | null;
  self_claimed: boolean;

  // Only once the job is theirs — see `RiderJobView` on the server for why a
  // stranger's address is not on a public board.
  customer_name?: string;
  customer_phone?: string;
  delivery_address?: string;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
  shop_phone?: string | null;
  stage?: JobStage;
  accepted_at?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  items?: { product_name: string; variant_name: string | null; unit_name: string | null; quantity: number }[];
}

export interface RiderEarnings {
  deliveries: number;
  earned: number;
  cash_in_hand: number;
  cash_orders: number;
  by_shop: { shop: string | null; orders: number; cash: number }[];
}

export interface RiderBoard {
  is_online: boolean;
  can_ride: boolean;
  status: RiderStatus;
  active: RiderJob[];
  offers: RiderJob[];
  job_limit: number;
  earnings_today: RiderEarnings;
  /** The server's clock, so "updated 5s ago" is not a phone's opinion. */
  as_of: string;
}

export interface ApplyInput {
  vehicle_type: VehicleType;
  vehicle_registration?: string | null;
  cnic: string;
  city_id?: string | null;
  is_platform?: boolean;
}

export const riderService = {
  me: () => apiGet<{ profile: RiderProfile | null }>("/rider/me"),
  apply: (body: ApplyInput) => apiPost<RiderProfile>("/rider/apply", body),
  submit: () => apiPost<RiderProfile>("/rider/submit", {}),

  /**
   * A photograph of a document.
   *
   * Multipart, and the `Content-Type` is left for the runtime to set: React
   * Native has to append its own multipart boundary, and naming the header by
   * hand is how an upload arrives with no boundary at all and 422s.
   */
  uploadDocument: (type: string, file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append("type", type);
    form.append("file", file as unknown as Blob);
    return apiPost<RiderProfile>("/rider/documents", form);
  },

  setOnline: (is_online: boolean, at?: { latitude: number; longitude: number }) =>
    apiPost<RiderProfile>("/rider/online", { is_online, ...at }),
  ping: (at: { latitude?: number; longitude?: number }) =>
    apiPost<{ is_online: boolean; last_seen_at: string | null }>("/rider/ping", at),

  board: () => apiGet<RiderBoard>("/rider/board"),
  earnings: (from?: string, to?: string) =>
    apiGet<RiderEarnings>("/rider/earnings", { params: { from, to } }),

  accept: (id: string) => apiPost<RiderJob>(`/rider/jobs/${id}/accept`, {}),
  decline: (id: string) => apiPost<null>(`/rider/jobs/${id}/decline`, {}),
  pickUp: (id: string) => apiPost<RiderJob>(`/rider/jobs/${id}/pick-up`, {}),
  deliver: (id: string, code: string) => apiPost<RiderJob>(`/rider/jobs/${id}/deliver`, { code }),
};
