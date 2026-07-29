import { apiGet } from "../../../common/api/client";

/** A serial/IMEI lookup result — what was sold, when, and its warranty state. */
export interface WarrantyRecord {
  serial: string;
  product_name: string;
  sold_at: string | null;
  warranty_months: number | null;
  warranty_expires_at: string | null;
  under_warranty: boolean;
  days_left: number;
  sale: {
    id: string;
    invoice_number: string;
    status: string;
    customer_name: string | null;
    customer_phone: string | null;
    total: string | number;
  } | null;
}

export const warrantyService = {
  // Look up a serial / IMEI at the warranty desk.
  lookup: (serial: string) =>
    apiGet<WarrantyRecord>("/warranty/lookup", { params: { serial } }),
};
