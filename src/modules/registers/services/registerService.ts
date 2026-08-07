import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import type { HardwareDevice } from "../../hardware/services/hardwareService";

/** A checkout lane. `open_session` is live status for the lane picker. */
export interface Register {
  id: string;
  branch_id: string | null;
  name: string;
  code: string | null;
  is_active: boolean;
  label?: string;
  is_busy?: boolean;
  open_session?: {
    id: string;
    user_id: string;
    user_name: string | null;
    opened_at: string;
    opening_float: string | number;
  } | null;
  branch?: { id: string; name: string } | null;
}

export interface RegisterPayload {
  name: string;
  code?: string | null;
  branch_id?: string | null;
  is_active?: boolean;
}

/** What this terminal is and what hardware it drives. */
export interface TerminalInfo {
  register: Register | null;
  branch: { id: string; name: string } | null;
  session: { id: string; status: string } | null;
  /** Resolved per type: the lane's own device, else the shop-wide fallback. */
  devices: Partial<Record<HardwareDevice["type"], HardwareDevice>>;
}

export interface ShiftRow {
  id: string;
  status: "open" | "closed";
  opening_float: string | number;
  cash_sales: string | number;
  expected_cash: string | number | null;
  counted_cash: string | number | null;
  variance: string | number | null;
  sales_count: number;
  sales_total: string | number;
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  user?: { id: string; name: string } | null;
  register?: { id: string; name: string; code: string | null } | null;
  branch?: { id: string; name: string } | null;
  /**
   * A practice shift. Listed in the history — somebody really did stand at a
   * till — but excluded from `totals`, which is what a manager reads as
   * takings. Anything rendering these rows must label it, or the figures on a
   * training row read as real ones.
   */
  is_training?: boolean;
}

export interface ShiftDay {
  sessions: ShiftRow[];
  totals: {
    shifts: number;
    open: number;
    opening_float: number;
    cash_sales: number;
    expected_cash: number;
    counted_cash: number;
    variance: number;
    sales_total: number;
    sales_count: number;
  };
  from: string;
  to: string;
}

export const registerService = {
  // Manager: configure lanes.
  list: () => apiGet<Register[]>("/registers"),
  create: (payload: RegisterPayload) => apiPost<Register>("/registers", payload),
  update: (id: string, payload: Partial<RegisterPayload>) => apiPut<Register>(`/registers/${id}`, payload),
  remove: (id: string) => apiDelete<null>(`/registers/${id}`),

  // Cashier: pick a lane, know the terminal.
  lanes: () => apiGet<Register[]>("/pos/registers"),
  terminal: () => apiGet<TerminalInfo>("/pos/terminal"),

  // Manager: the consolidated day across every lane, and freeing an
  // abandoned one so a checkout isn't idle waiting for one person.
  shiftDay: (params?: { from?: string; to?: string; register_id?: string; status?: "open" | "closed" }) =>
    apiGet<ShiftDay>("/pos/sessions", { params }),
  forceClose: (registerId: string, counted_cash: number, notes?: string) =>
    apiPost<ShiftRow>(`/pos/registers/${registerId}/close`, { counted_cash, notes }),
};
