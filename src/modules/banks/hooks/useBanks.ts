import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  banksService,
  type BankInput,
  type BankOfferInput,
  type CardType,
} from "../services/banksService";

const KEY = ["banks"];
const LIVE = ["banks", "live"];

// ── The office ────────────────────────────────────────────────────────

export function useBanks(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await banksService.list()).data,
    enabled,
  });
}

/**
 * Every write invalidates the WHOLE list, including the live one.
 *
 * A bank and its offers are one thing on screen and two tables underneath, and
 * switching an offer off changes what a cashier is allowed to pick. Patching a
 * single row locally would leave the counter offering a deal the office had
 * just ended — which is money.
 */
function refetchEverything(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: KEY });
  queryClient.invalidateQueries({ queryKey: LIVE });
}

export function useSaveBank() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: BankInput & { id?: string }) =>
      id ? banksService.update(id, payload) : banksService.create(payload),
    onSuccess: () => refetchEverything(queryClient),
  });
}

export function useDeleteBank() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => banksService.remove(id),
    onSuccess: () => refetchEverything(queryClient),
  });
}

export function useSaveBankOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: BankOfferInput & { id?: string }) =>
      id ? banksService.updateOffer(id, payload) : banksService.createOffer(payload),
    onSuccess: () => refetchEverything(queryClient),
  });
}

export function useDeleteBankOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => banksService.removeOffer(id),
    onSuccess: () => refetchEverything(queryClient),
  });
}

// ── The counter ───────────────────────────────────────────────────────

/**
 * Banks worth offering a cashier right now.
 *
 * `enabled` so a till that is not taking a card never asks. Most shops have no
 * bank deals at all, and the row this feeds simply does not appear for them.
 */
export function useLiveBanks(enabled: boolean) {
  return useQuery({
    queryKey: LIVE,
    queryFn: async () => (await banksService.live()).data,
    enabled,
    // The office can end a campaign mid-afternoon, and a counter still offering
    // it is a discount the shop funds itself. Cheap call, small list.
    staleTime: 60_000,
  });
}

/**
 * Ask what comes off. Never compute it here.
 *
 * A mutation rather than a query because it is a question about a cart that is
 * being built — it should fire when the cashier asks, not on a cache key that
 * changes with every keystroke.
 */
export function useBankQuote() {
  return useMutation({
    mutationFn: (payload: { bank_id: string; card_amount: number; card_type?: CardType | null }) =>
      banksService.quote(payload),
  });
}
