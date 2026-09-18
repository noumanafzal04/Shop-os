import { apiGet, apiPost } from "@cartze/core/api/client";
import type { ApiEnvelope } from "@cartze/core/types/api";
import type { LoginPayload, SessionUser } from "../../../types/session";

/**
 * Signing in, for a shop.
 *
 * ── Who may use this app ─────────────────────────────────────────────
 *
 * ANY tenant user — the owner, or a staff member the owner created. There is
 * no separate "partner account": the same credentials that open the web panel
 * open this. What a person can DO here is their permission list, which is why
 * `tabsFor` exists and why nothing in this app asks what somebody's job is.
 *
 * ── `identifier`, not `email` ────────────────────────────────────────
 *
 * The server takes either an email or a phone number in one field. A shop in
 * Lahore is far more likely to know its phone number than the address it was
 * registered with, and forcing a choice of field before somebody has typed
 * anything is a decision they should not have to make.
 */
export const authService = {
  /**
   * The ENVELOPE is returned, not its `data`.
   *
   * Same convention as the customer app. It costs one `.data` at each call
   * site and buys `meta.pagination` on the endpoints that have it — unwrapping
   * here would mean a second, different helper the first time Orders needs a
   * page two, which is a fork this codebase has paid for before.
   */
  async login(identifier: string, password: string): Promise<ApiEnvelope<LoginPayload>> {
    return apiPost<LoginPayload>("/auth/login", {
      identifier: identifier.trim(),
      password,
      // Named so a shopkeeper can recognise it in the panel's device list and
      // revoke the right one. "api" — the server's default — tells them
      // nothing.
      device_name: "CartZe Partner",
    });
  },

  /**
   * Who the stored token belongs to.
   *
   * Called at boot with whatever was in the Keychain. It is the ONLY thing
   * that decides a remembered session is still good: an access token lives an
   * hour, so a stored one is usually dead, and an app that assumes otherwise
   * paints a dashboard of empty states before the first 401 arrives.
   */
  async me(): Promise<ApiEnvelope<SessionUser>> {
    return apiGet<SessionUser>("/auth/me");
  },
};
