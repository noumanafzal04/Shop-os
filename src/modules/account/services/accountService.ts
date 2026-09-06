import { apiDelete, apiGet, apiPost } from "../../../common/api/client";

/** One signed-in device, as the server knows it. */
export interface AuthSession {
  id: string;
  device_name: string;
  last_used_at: string | null;
  created_at: string | null;
  expires_at: string | null;
  is_current: boolean;
}

export const accountService = {
  /**
   * Changing the password ALSO ends every other session, server-side. The
   * screen says so before the button is pressed — a person changing a password
   * because somebody else has it needs to know the other phone is being pushed
   * out, and a person who was only tidying up needs to know their tablet will
   * ask them to sign in again.
   */
  changePassword: (payload: {
    current_password: string;
    password: string;
    password_confirmation: string;
  }) => apiPost<null>("/auth/password/change", payload),

  sessions: () => apiGet<AuthSession[]>("/auth/sessions"),

  revokeSession: (id: string) => apiDelete<null>(`/auth/sessions/${id}`),
};
