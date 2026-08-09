import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { purchasesService } from "../services/purchasesService";
import type { PaymentInput, PurchaseOrderInput, SupplierInput } from "../types";

// ── Suppliers ───────────────────────────────────────────────────

/**
 * The vendor directory.
 *
 * `enabled` exists because this list is now offered from screens that are NOT
 * about buying — the expense form asks who was paid. Reading suppliers needs
 * the inventory module and one of three permissions, so a book-keeper who can
 * file bills all day would otherwise fire a 403 every time that page opened.
 * Callers on the purchasing screens are already behind the same gate and can
 * leave it alone.
 */
export function useSuppliers(
  params?: { search?: string; is_active?: boolean; page?: number },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["suppliers", params],
    queryFn: () => purchasesService.suppliers(params),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export function useSupplier(id: string | undefined) {
  return useQuery({
    queryKey: ["suppliers", "detail", id],
    queryFn: async () => (await purchasesService.supplier(id!)).data,
    enabled: !!id,
  });
}

export function useSupplierMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
  };

  const create = useMutation({ mutationFn: (p: SupplierInput) => purchasesService.createSupplier(p), onSuccess: invalidate });
  const update = useMutation({ mutationFn: ({ id, ...p }: { id: string } & Partial<SupplierInput>) => purchasesService.updateSupplier(id, p), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => purchasesService.deleteSupplier(id), onSuccess: invalidate });
  const pay = useMutation({
    mutationFn: ({ supplierId, ...p }: { supplierId: string } & PaymentInput) => purchasesService.paySupplier(supplierId, p),
    onSuccess: invalidate,
  });

  return { create, update, remove, pay };
}

// ── Purchase orders ─────────────────────────────────────────────

export function usePurchaseOrders(params?: { search?: string; status?: string; supplier_id?: string; page?: number }) {
  return useQuery({
    queryKey: ["purchase-orders", params],
    queryFn: () => purchasesService.purchaseOrders(params),
    placeholderData: keepPreviousData,
  });
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["purchase-orders", "detail", id],
    queryFn: async () => (await purchasesService.purchaseOrder(id!)).data,
    enabled: !!id,
  });
}

export function usePurchaseOrderMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const create = useMutation({ mutationFn: (p: PurchaseOrderInput) => purchasesService.createPurchaseOrder(p), onSuccess: invalidate });
  const place = useMutation({ mutationFn: (id: string) => purchasesService.place(id), onSuccess: invalidate });
  const receive = useMutation({
    // idempotency_key: one stable key per receive intent — a retry after a
    // network error replays the same receipt instead of double-receiving.
    mutationFn: ({ id, items, idempotency_key }: { id: string; items?: Array<{ id: string; quantity: number; batch_number?: string; expiry_date?: string; serials?: string[] }>; idempotency_key?: string }) =>
      purchasesService.receive(id, items, idempotency_key),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => purchasesService.cancel(id, reason),
    onSuccess: invalidate,
  });

  return { create, place, receive, cancel };
}
