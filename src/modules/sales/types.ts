export type SaleChannel = "walk_in" | "phone" | "whatsapp" | "online";
export type SaleStatus = "completed" | "cancelled";
export type PaymentMethod = "cash" | "card" | "bank_transfer" | "other";

export interface SaleItem {
  id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: string;
  line_total: string;
}

export interface Sale {
  id: string;
  invoice_number: string;
  channel: SaleChannel;
  status: SaleStatus;
  customer_name: string | null;
  subtotal: string;
  discount: string;
  total: string;
  payment_method: PaymentMethod;
  amount_paid: string;
  change_due: string;
  sold_at: string;
  items?: SaleItem[];
  items_count?: number;
}

export interface SaleInput {
  channel: SaleChannel;
  customer_name?: string;
  items: Array<{
    product_id: string;
    variant_id?: string | null;
    quantity: number;
    unit_price?: number;
  }>;
  discount?: number;
  payment_method: PaymentMethod;
  amount_paid: number;
  idempotency_key?: string;
}
