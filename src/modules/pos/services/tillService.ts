import { apiDelete, apiGet, apiPost, apiPut } from "../../../common/api/client";
import type { User } from "../../auth/types";

/** One row of the lock screen's roster. Never carries anything secret. */
export interface TillUser {
  id: string;
  name: string;
  role: "shop_owner" | "staff";
  has_pin: boolean;
  /** Frozen by repeated wrong PINs — the screen says so instead of just failing. */
  pin_locked: boolean;
}

export interface UnlockResult {
  user: User;
  /** True when the till changed hands and new tokens came with it. */
  switched: boolean;
  access_token?: string;
  refresh_token?: string;
}

export const tillService = {
  /** Who can take this till. */
  roster: () => apiGet<TillUser[]>("/pos/till-users"),

  /**
   * Unlock, or hand the till to someone else. The server decides which:
   * same person → the session is untouched; different person → a new session,
   * and the outgoing one on this device is destroyed.
   */
  unlock: (user_id: string, pin: string) => apiPost<UnlockResult>("/pos/unlock", { user_id, pin }),

  setOwnPin: (current_password: string, pin: string) =>
    apiPut<null>("/auth/till-pin", { current_password, pin }),

  clearOwnPin: () => apiDelete<null>("/auth/till-pin"),

  setStaffPin: (staffId: string, pin: string) => apiPut<null>(`/staff/${staffId}/pin`, { pin }),

  clearStaffPin: (staffId: string) => apiDelete<null>(`/staff/${staffId}/pin`),
};
