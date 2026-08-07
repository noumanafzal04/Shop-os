import { apiDelete, apiGet, apiPost } from "../../../common/api/client";
import type { LoginPayload, LoginResponse, User } from "../types";

/** One device signed in to this account. */
export interface DeviceSession {
  id: string;
  device_name: string;
  last_used_at: string | null;
  created_at: string | null;
  expires_at: string | null;
  /** The one you are reading this on. Never offered for revocation. */
  is_current: boolean;
}

export const authService = {
  login: (payload: LoginPayload) =>
    apiPost<LoginResponse>("/auth/login", {
      device_name: "web",
      ...payload,
    }),

  me: () => apiGet<User>("/auth/me"),

  logout: () => apiPost<null>("/auth/logout"),

  logoutAll: () => apiPost<null>("/auth/logout-all"),

  changePassword: (payload: {
    current_password: string;
    password: string;
    password_confirmation: string;
  }) => apiPost<null>("/auth/password/change", payload),

  /** Where this account is signed in. */
  sessions: () => apiGet<DeviceSession[]>("/auth/sessions"),

  /** Sign one device out. Its refresh token dies with it. */
  revokeSession: (tokenId: string) => apiDelete<null>(`/auth/sessions/${tokenId}`),

  requestOtp: (identifier: string, purpose: "login" | "password_reset" | "verification") =>
    apiPost<{ debug_code?: string } | null>("/auth/otp/request", { identifier, purpose }),

  otpLogin: (identifier: string, code: string) =>
    apiPost<LoginResponse>("/auth/otp/login", { identifier, code, device_name: "web" }),

  resetPassword: (payload: {
    identifier: string;
    code: string;
    password: string;
    password_confirmation: string;
  }) => apiPost<null>("/auth/password/reset", payload),
};
