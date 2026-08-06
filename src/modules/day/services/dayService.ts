import { api, apiGet, apiPost } from "../../../common/api/client";

/**
 * A person on a record — who opened the day, who signed it off, who took the
 * cash to the bank.
 *
 * The backend serialises `openedBy` over the `opened_by` column, so the SAME
 * key is a plain id when the relation wasn't loaded and an object when it was.
 * Read it through `signerName()` rather than assuming either shape.
 */
export type Signer = { id: string; name: string } | string | null;

export function signerName(signer: Signer): string | null {
  return typeof signer === "object" && signer !== null ? signer.name : null;
}

/**
 * The trading day, and what left for the bank.
 *
 * A shift answers "did this cashier's drawer balance". Neither it nor any
 * number of them answers what an owner actually asks at 10pm — "what did the
 * shop take today, and how much of it is going to the bank" — because that
 * spans three drawers plus the safe.
 */
export interface BusinessDay {
  id: string;
  branch_id: string | null;
  trading_date: string;
  status: "open" | "closed";
  opened_at: string | null;
  closed_at: string | null;
  opened_by: Signer;
  closed_by: Signer;
  /** Every figure below is null until the day is closed off. */
  shifts_count: number | null;
  opening_float: string | number | null;
  cash_sales: string | number | null;
  cash_in: string | number | null;
  cash_out: string | number | null;
  expected_cash: string | number | null;
  counted_cash: string | number | null;
  variance: string | number | null;
  sales_count: number | null;
  sales_total: string | number | null;
  banked_amount: string | number | null;
  /** Every lane's card total is one card total to whoever reconciles it. */
  tender_mix: Record<string, number> | null;
  notes: string | null;
  branch?: { id: string; name: string } | null;
}

export interface DayShift {
  id: string;
  status: "open" | "closed";
  opening_float: string | number;
  cash_sales: string | number | null;
  expected_cash: string | number | null;
  counted_cash: string | number | null;
  variance: string | number | null;
  sales_count: number | null;
  sales_total: string | number | null;
  opened_at: string;
  closed_at: string | null;
  user?: { id: string; name: string } | null;
  register?: { id: string; name: string } | null;
  /**
   * Present ONLY while the shift is open. A shift's columns are frozen at
   * close, so a drawer that has been selling all afternoon reads zero until
   * someone counts it — these are the same figures, computed live.
   */
  live?: {
    sales_count: number;
    sales_total: number;
    cash_sales: number;
    expected_cash: number;
  };
}

export interface BankDeposit {
  id: string;
  business_day_id: string | null;
  amount: string | number;
  bank_name: string | null;
  account_label: string | null;
  /** What makes the record provable against a statement weeks later. */
  slip_number: string | null;
  deposited_at: string;
  deposited_by: Signer;
  notes: string | null;
  branch?: { id: string; name: string } | null;
  business_day?: { id: string; trading_date: string } | null;
}

export interface DayView {
  day: BusinessDay;
  sessions: DayShift[];
  running: {
    shifts: number;
    open_shifts: number;
    sales_count: number;
    sales_total: number;
    cash_sales: number;
    /** What every drawer in the shop should be holding right now. */
    expected_cash: number;
    /** Closed shifts only — an open drawer has not been counted yet. */
    counted_cash: number;
    variance: number;
  };
  banked: number;
  /** Today's takings still in the shop. Floats excluded — they stay. */
  unbanked: number;
  deposits: BankDeposit[];
}

export type DayDetail = BusinessDay & { sessions: DayShift[]; deposits: BankDeposit[] };

export interface DepositInput {
  amount: number;
  bank_name?: string | null;
  account_label?: string | null;
  slip_number?: string | null;
  deposited_at?: string | null;
  notes?: string | null;
}

export const dayService = {
  /** The day currently trading. `data` is null when no shift has opened yet. */
  current: () => apiGet<DayView | null>("/pos/day"),

  /**
   * The Z-read for a counted shift, as printable HTML.
   *
   * Every figure on it comes off the frozen close row rather than being
   * recomputed, so a slip reprinted next year still matches the one that was
   * signed that night — a Z-read that moves retroactively is evidence of
   * nothing. The server refuses an open shift for the same reason.
   */
  zReport: async (sessionId: string, paper?: string): Promise<string> => {
    const res = await api.get<string>(`/pos/sessions/${sessionId}/z-report/print`, {
      params: { paper },
      responseType: "text",
      headers: { Accept: "text/html" },
      transformResponse: (r) => r, // keep raw HTML — don't try to JSON-parse it
    });

    return res.data;
  },

  history: (params: { from?: string; to?: string; page?: number } = {}) =>
    apiGet<BusinessDay[]>("/pos/days", { params }),

  show: (id: string) => apiGet<DayDetail>(`/pos/days/${id}`),

  close: (id: string, notes?: string) => apiPost<BusinessDay>(`/pos/days/${id}/close`, { notes }),

  deposits: (params: { from?: string; to?: string; page?: number } = {}) =>
    apiGet<BankDeposit[]>("/pos/deposits", { params }),

  recordDeposit: (payload: DepositInput) => apiPost<BankDeposit>("/pos/deposits", payload),
};
