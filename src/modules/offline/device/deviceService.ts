import { apiDelete, apiGet, apiPost } from "../../../common/api/client";

/** One till, as the shop sees it. Carries nothing secret. */
export interface PosDevice {
  id: string;
  name: string | null;
  platform: "web" | "android" | "ios" | null;
  branch: { id: string; name: string } | null;
  register: { id: string; name: string } | null;
  last_seen_at: string | null;
  /** Whole days since this till last reached the server. */
  days_offline: number;
  revoked: boolean;
  revoked_at: string | null;
}

export interface DeviceRoster {
  devices: PosDevice[];
  /**
   * How many days a till in this shop may keep SELLING out of contact —
   * assigned per shop by an admin, exactly like its branches and staff. It
   * travels with the roster so the till knows what to degrade against without a
   * second call. Null means no ceiling was set.
   */
  offline_days: number | null;
}

export const deviceService = {
  /**
   * Announce this till.
   *
   * Called on EVERY boot, not only the first: the touch is the feature. How
   * long ago a device last called is the whole of the offline policy, so a till
   * that stops calling is precisely what the policy is measuring.
   *
   * Idempotent — the same client-minted id simply touches the row it already
   * has.
   */
  register: (deviceId: string, name?: string | null) =>
    apiPost<PosDevice>("/pos/devices", {
      device_id: deviceId,
      platform: "web",
      // Only ever sent when there is one: an empty name on a routine boot must
      // not blank the "Counter tablet" the shop typed.
      ...(name ? { name } : {}),
    }),

  /** Every till this shop runs on, worst out-of-contact first. */
  list: () => apiGet<DeviceRoster>("/pos-devices"),

  /**
   * Stop a till being used — the tablet that was lost.
   *
   * Not a delete on the server either: the sales it already sent still point at
   * it, and why it was signed out is what an owner reads afterwards.
   */
  revoke: (id: string) => apiDelete<PosDevice>(`/pos-devices/${id}`),

  /** Allow a signed-out till back. The tablet turned up. */
  restore: (id: string) => apiPost<PosDevice>(`/pos-devices/${id}/restore`, {}),
};
