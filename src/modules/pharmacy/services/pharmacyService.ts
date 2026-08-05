import { apiGet } from "../../../common/api/client";

export interface DrugRef {
  id: string;
  name: string;
  brand: string | null;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  schedule: string | null;
  requires_prescription: boolean;
  price: number;
  stock_quantity: number;
}

export interface Alternative extends DrugRef {
  /** Flagged rather than filtered — 2 × 250mg is a real answer. */
  same_strength: boolean;
  same_form: boolean;
}

export interface AlternativesResult {
  source: DrugRef;
  /** "no_generic_name" means we couldn't ask the question, not that there's no answer. */
  reason: "no_generic_name" | null;
  alternatives: Alternative[];
}

export interface BatchAllocation {
  batch_id?: string;
  batch_number: string;
  expiry_date: string | null;
  quantity: number;
}

export interface DispensingRow {
  sale_id: string;
  invoice_number: string | null;
  dispensed_at: string | null;
  drug: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  schedule: string | null;
  quantity: number;
  batches: BatchAllocation[];
  prescription_number: string | null;
  patient_name: string | null;
  prescriber_name: string | null;
  customer_phone: string | null;
}

export interface RecallResult {
  batch_number: string;
  on_hand: Array<{
    product_id: string;
    product_name: string | null;
    branch_id: string | null;
    expiry_date: string | null;
    quantity: number;
  }>;
  dispensed: Array<{
    sale_id: string;
    invoice_number: string;
    sold_at: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    prescriber_name: string | null;
    prescription_number: string | null;
    quantity: number;
  }>;
  /** Sales with no phone number — people the shop cannot telephone. */
  unreachable: number;
}

export const pharmacyService = {
  alternatives: (productId: string, inStockOnly = true) =>
    apiGet<AlternativesResult>("/pharmacy/alternatives", {
      params: { product_id: productId, in_stock_only: inStockOnly ? 1 : 0 },
    }),

  dispensing: (params: { from?: string; to?: string; search?: string; controlled_only?: boolean }) =>
    apiGet<{ from: string; to: string; rows: DispensingRow[] }>("/pharmacy/dispensing", {
      params: {
        from: params.from || undefined,
        to: params.to || undefined,
        search: params.search || undefined,
        controlled_only: params.controlled_only ? 1 : undefined,
      },
    }),

  recall: (batchNumber: string) =>
    apiGet<RecallResult>("/pharmacy/recall", { params: { batch_number: batchNumber } }),
};
