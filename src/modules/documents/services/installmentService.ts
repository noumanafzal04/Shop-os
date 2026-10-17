import { apiGet, apiPost } from "../../../common/api/client";
import type { PlanStanding } from "../installments";

export type PlanStatus = "running" | "paid_off" | "closed";

/** The list's filters — `due_soon`, `this_month` and `late` are worked out on the day asked. */
export type PlanFilter = "running" | "due_soon" | "this_month" | "late" | "paid_off" | "closed" | "all";

export interface InstallmentPlan {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  sale_id: string | null;
  sale?: { id: string; invoice_number: string; sold_at?: string } | null;
  items: Array<{ name: string; quantity: number }>;
  cash_price: string;
  markup_percent: string;
  markup: string;
  total: string;
  advance: string;
  financed: string;
  months: number;
  monthly: string;
  last_month: string;
  first_due_on: string;
  status: PlanStatus;
  paid: string;
  next_due_on: string | null;
  notes: string | null;
  created_at: string;
  paid_off_at: string | null;
  standing: PlanStanding;
  /** The plan's own page only: money paid since the advance, and what came off by the goods coming back. */
  collected?: number;
  returned?: number;
  /** The plan's own page only: every payment against it, oldest first. */
  payments?: Array<{ id: string; amount: number; method: string; reference: string | null; at: string | null; taken_by: string | null }>;
}

export interface PlanSummary {
  out: number;
  /** Still to come from today to the month's end — what is late is counted under `late`, not here too. */
  due_this_month: number;
  late: { total: number; plans: number };
  collected_this_month: number;
  counts: Record<PlanFilter, number>;
}

export interface StartPlanInput {
  customer_name?: string;
  customer_phone: string;
  items: Array<{ product_id: string; variant_id?: string | null; quantity: number }>;
  markup_percent?: number;
  advance?: { amount: number; method: string; reference?: string };
  months: number;
  first_due_on: string;
  notes?: string;
  /** The bill the sheet read out — the server refuses to write another (PLAN_PRICE_CHANGED). */
  expected_total?: number;
  idempotency_key?: string;
}

/** What a plan on these terms will be — the server's figures, before the press (money pass $8). */
export interface PlanWorth {
  cash_price: number;
  markup_percent: number;
  markup: number;
  total: number;
  advance: number;
  financed: number;
  months: number;
  monthly: number;
  last_month: number;
}

export type PlanWorthInput = Pick<StartPlanInput, "items" | "markup_percent" | "months"> & {
  customer_phone?: string;
  advance?: { amount: number; method: string };
};

export interface InstallmentInput {
  amount: number;
  method: string;
  reference?: string;
  idempotency_key?: string;
}

export const installmentService = {
  list: (params: { status?: PlanFilter | ""; search?: string; customer_id?: string; page?: number }) =>
    apiGet<InstallmentPlan[]>("/installment-plans", { params: { ...params, status: params.status || undefined } }),
  summary: () => apiGet<PlanSummary>("/installment-plans/summary"),
  show: (id: string) => apiGet<InstallmentPlan>(`/installment-plans/${id}`),
  start: (payload: StartPlanInput) => apiPost<InstallmentPlan>("/installment-plans", payload),
  /** Asked before the press; writes nothing. */
  worth: (payload: PlanWorthInput) => apiPost<PlanWorth>("/installment-plans/worth", payload),
  pay: (id: string, payload: InstallmentInput) =>
    apiPost<{ entry: unknown; plan: InstallmentPlan }>(`/installment-plans/${id}/payments`, payload),
};
