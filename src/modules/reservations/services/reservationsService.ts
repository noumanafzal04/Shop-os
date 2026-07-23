import { apiGet, apiPost } from "../../../common/api/client";

export type ReservationStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "completed"
  | "expired";

export interface Reservation {
  id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: string;
  status: ReservationStatus;
  notes: string | null;
  reject_reason: string | null;
  expires_at: string;
  accepted_at: string | null;
  sale_id: string | null;
  created_at: string;
  customer?: { id: string; name: string; phone: string | null };
}

export const reservationsService = {
  list: (params: { status?: string; page?: number }) =>
    apiGet<Reservation[]>("/reservations", {
      params: { status: params.status || undefined, page: params.page ?? 1 },
    }),

  accept: (id: string) => apiPost<Reservation>(`/reservations/${id}/accept`),

  reject: (id: string, reason?: string) =>
    apiPost<Reservation>(`/reservations/${id}/reject`, { reason }),

  complete: (id: string, payment: { payment_method: string; amount_paid: number }) =>
    apiPost<Reservation>(`/reservations/${id}/complete`, payment),
};
