import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { receiptService } from "../services/receiptService";
import { useAuthStore } from "../../../stores/authStore";

/** Every copy of one sale. Only fetched when the trail is actually open. */
export function useReceiptTrail(saleId: string | null) {
  return useQuery({
    queryKey: ["receipt-trail", saleId],
    queryFn: async () => (await receiptService.trail(saleId!)).data,
    enabled: !!saleId,
  });
}

/**
 * The reprint tray. Polled while the till is open — a receipt that failed on
 * lane 2 is still the shop's problem when the cashier walks to lane 3.
 */
export function useFailedReceipts(enabled = true) {
  const role = useAuthStore((s) => s.user?.role);
  const isShop = role === "shop_owner" || role === "staff";
  return useQuery({
    queryKey: ["receipts", "pending"],
    queryFn: async () => (await receiptService.pending()).data,
    enabled: enabled && isShop,
    refetchInterval: 60_000,
  });
}

export function useReprintReport(range: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ["reports", "reprints", range.from ?? "", range.to ?? ""],
    queryFn: async () => (await receiptService.report(range)).data,
    placeholderData: keepPreviousData,
  });
}

/**
 * The live receipt preview for Shop Settings. Debounced by the caller passing
 * a settled object; kept as a query so it caches per settings combination and
 * doesn't re-render the iframe on every keystroke.
 */
export function useReceiptPreview(
  overrides: Record<string, string | number | boolean | string[] | null>,
  enabled = true,
) {
  return useQuery({
    queryKey: ["receipt-preview", overrides],
    queryFn: () => receiptService.preview(overrides),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
