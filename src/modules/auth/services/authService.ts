import { apiGet, apiPost } from "../../../common/api/client";
import type { LoginPayload, LoginResponse, User } from "../types";

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
