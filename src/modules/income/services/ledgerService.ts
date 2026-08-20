import { apiGet } from "../../../common/api/client";
import type { ApiEnvelope } from "../../../common/types/api";
import { toParams, type MoneyFilters } from "../../expenses/services/moneyFilters";
import type { Pagination } from "../../../common/types/api";

/**
 * Which way the money went, and where the row came from.
 *
 * `supplier_payment` is a fifth SOURCE of money, not a kind of expense — a shop
 * that pays its wholesaler and also files the wholesaler's bill would otherwise
 * count the same rupees twice. It was added to LedgerService::TYPES on the
 * server and never here, so those rows arrived in the ledger with no label and
 * could not be filtered for.
 */
export type LedgerType = "sale" | "income" | "expense" | "refund" | "supplier_payment";

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
  pagination?: Pagination;
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
  supplier_payment: { label: "Supplier paid", tone: "error" },
};
