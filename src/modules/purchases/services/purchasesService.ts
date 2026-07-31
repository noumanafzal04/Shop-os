import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import type {
  PaymentInput,
  PurchaseOrder,
  PurchaseOrderInput,
  Supplier,
  SupplierInput,
  SupplierPayment,
} from "../types";

export const purchasesService = {
  // ── Suppliers ───────────────────────────────────────────────────
  suppliers: (params?: { search?: string; is_active?: boolean; page?: number }) =>
    apiGet<Supplier[]>("/suppliers", { params }),
  supplier: (id: string) => apiGet<Supplier>(`/suppliers/${id}`),
  createSupplier: (payload: SupplierInput) => apiPost<Supplier>("/suppliers", payload),
  updateSupplier: (id: string, payload: Partial<SupplierInput>) =>
    apiPut<Supplier>(`/suppliers/${id}`, payload),
  deleteSupplier: (id: string) => apiDelete<null>(`/suppliers/${id}`),
  paySupplier: (supplierId: string, payload: PaymentInput) =>
    apiPost<SupplierPayment>(`/suppliers/${supplierId}/payments`, payload),

  // ── Purchase orders ─────────────────────────────────────────────
  purchaseOrders: (params?: { search?: string; status?: string; supplier_id?: string; page?: number }) =>
    apiGet<PurchaseOrder[]>("/purchase-orders", { params }),
  purchaseOrder: (id: string) => apiGet<PurchaseOrder>(`/purchase-orders/${id}`),
  createPurchaseOrder: (payload: PurchaseOrderInput) =>
    apiPost<PurchaseOrder>("/purchase-orders", payload),
  place: (id: string) => apiPost<PurchaseOrder>(`/purchase-orders/${id}/place`),
  receive: (
    id: string,
    items?: Array<{ id: string; quantity: number; batch_number?: string; expiry_date?: string; serials?: string[] }>,
    idempotencyKey?: string,
  ) =>
    apiPost<PurchaseOrder>(`/purchase-orders/${id}/receive`, {
      ...(items ? { items } : {}),
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    }),
  cancel: (id: string, reason?: string) =>
    apiPost<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { reason }),
};
