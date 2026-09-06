import { apiGet, apiPost } from "../../../common/api/client";
import type { LoginPayload, LoginResponse, User } from "../types";

export const authService = {
  login: (payload: LoginPayload) =>
    apiPost<LoginResponse>("/auth/login", {
      device_name: "mobile",
      ...payload,
    }),

  me: () => apiGet<User>("/auth/me"),

  logout: () => apiPost<null>("/auth/logout"),

  /**
   * Every device, this one included — the server deletes all of the user's
   * tokens, so the phone that asked is signed out too. That is the point: it
   * is what somebody presses when they think another person has their
   * password, and leaving the asking device signed in would be an odd promise.
   */
  logoutAll: () => apiPost<null>("/auth/logout-all"),

  requestOtp: (identifier: string, purpose: "login" | "password_reset" | "verification") =>
    apiPost<{ debug_code?: string } | null>("/auth/otp/request", { identifier, purpose }),

  otpLogin: (identifier: string, code: string) =>
    apiPost<LoginResponse>("/auth/otp/login", { identifier, code, device_name: "mobile" }),

  resetPassword: (payload: {
    identifier: string;
    code: string;
    password: string;
    password_confirmation: string;
  }) => apiPost<null>("/auth/password/reset", payload),
};
