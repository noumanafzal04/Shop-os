export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  outstanding?: number;
  purchase_orders?: PurchaseOrder[];
  payments?: SupplierPayment[];
}

export interface SupplierInput {
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export type PurchaseStatus =
  | "draft"
  | "ordered"
  | "partially_received"
  | "received"
  | "cancelled";

export interface PurchaseOrderItem {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  unit_name: string | null;
  quantity_ordered: number;
  quantity_received: number;
  unit_factor: string | number;
  unit_cost: string | number;
  line_total: string | number;
}

export interface PurchaseOrder {
  id: string;
  supplier_id: string;
  supplier?: { id: string; name: string };
  po_number: string;
  status: PurchaseStatus;
  order_date: string;
  expected_date: string | null;
  subtotal: string | number;
  discount: string | number;
  tax: string | number;
  total: string | number;
  amount_paid: string | number;
  payment_status: "unpaid" | "partial" | "paid";
  notes: string | null;
  received_at: string | null;
  items?: PurchaseOrderItem[];
  items_count?: number;
  payments?: SupplierPayment[];
}

export interface PurchaseOrderInput {
  supplier_id: string;
  order_date: string;
  expected_date?: string | null;
  discount?: number;
  tax?: number;
  notes?: string | null;
  status?: "draft" | "ordered";
  items: Array<{ product_id: string; variant_id?: string | null; product_unit_id?: string | null; quantity: number; unit_cost: number }>;
}

export interface SupplierPayment {
  id: string;
  supplier_id: string;
  purchase_order_id: string | null;
  purchase_order?: { id: string; po_number: string } | null;
  amount: string | number;
  method: "cash" | "bank_transfer" | "card" | "cheque";
  reference: string | null;
  paid_at: string;
  notes: string | null;
}

export interface PaymentInput {
  amount: number;
  method?: SupplierPayment["method"];
  reference?: string | null;
  paid_at?: string | null;
  notes?: string | null;
  purchase_order_id?: string | null;
}
