import { apiGet } from "../../../common/api/client";
import type { ApiEnvelope } from "../../../common/types/api";
import { toParams, type MoneyFilters } from "../../expenses/services/moneyFilters";

/** Which way the money went, and where the row came from. */
export type LedgerType = "sale" | "income" | "expense" | "refund";

export interface LedgerEntry {
  id: string;
  type: LedgerType;
  date: string;
  reference: string | null;
  description: string | null;
  category: string | null;
  category_id: string | null;
  method: string | null;
  in: number;
  out: number;
  /** The account's balance AFTER this row — the whole point of a ledger. */
  balance: number;
}

export interface LedgerMeta {
  period: { from: string; to: string };
  /** What the book stood at before the period. Never changed by a filter. */
  opening: number;
  closing: number;
  totals: { in: number; out: number; net: number; count: number };
  pagination?: { current_page: number; per_page: number; total: number; last_page: number };
}

/** The ledger's own filters — the shared money filters plus type/direction. */
export interface LedgerFilters extends MoneyFilters {
  type?: LedgerType[];
  direction?: "in" | "out";
}

export const ledgerService = {
  list: (filters: LedgerFilters) =>
    apiGet<LedgerEntry[]>("/ledger", {
      params: {
        ...toParams(filters),
        period: "custom",
        ...(filters.type?.length ? { type: filters.type.join(",") } : {}),
        ...(filters.direction ? { direction: filters.direction } : {}),
      },
    }) as Promise<ApiEnvelope<LedgerEntry[]> & { meta: LedgerMeta }>,
};

/** Row colour and label per source — one place, so the two views agree. */
export const LEDGER_TYPES: Record<LedgerType, { label: string; tone: "success" | "error" | "brand" | "gray" }> = {
  sale: { label: "Sale", tone: "success" },
  income: { label: "Income", tone: "brand" },
  expense: { label: "Expense", tone: "error" },
  refund: { label: "Refund", tone: "gray" },
};
