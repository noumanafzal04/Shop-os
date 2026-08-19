import { apiDelete, apiGet, apiPatch, apiPost } from "../../../common/api/client";
import { readTally } from "../pricing/shadowTally";

/** One till, as the shop sees it. Carries nothing secret. */
export interface PosDevice {
  id: string;
  name: string | null;
  platform: "web" | "android" | "ios" | null;
  branch: { id: string; name: string } | null;
  register: { id: string; name: string } | null;
  /**
   * The four characters this till prints in the middle of an offline slip,
   * allocated by the server so no two tills in one shop can share them.
   *
   * Null only from a server too old to allocate one; the till then falls back
   * to slicing its own id, which is what it always used to do.
   */
  // Optional: a server too old to allocate one sends nothing, and the till
  // falls back to slicing its own id exactly as it always did.
  code?: string | null;
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
  register: async (deviceId: string, name?: string | null) => {
    // What this till has checked with the offline engine, sent on the boot that
    // was happening anyway rather than on a call of its own. It has to travel
    // this way round: a till that finds NOTHING never reports a variance, and
    // that is precisely the till whose count the shop needs most.
    const tally = await readTally().catch(() => undefined);

    return apiPost<PosDevice>("/pos/devices", {
      device_id: deviceId,
      platform: "web",
      // Only ever sent when there is one: an empty name on a routine boot must
      // not blank the "Counter tablet" the shop typed.
      ...(name ? { name } : {}),
      ...(tally
        ? {
            shadow: {
              checked: tally.checked,
              matched: tally.matched,
              skipped: tally.skipped,
              differed: tally.differed,
              since: tally.since,
            },
          }
        : {}),
    });
  },

  /** Every till this shop runs on, worst out-of-contact first. */
  list: () => apiGet<DeviceRoster>("/pos-devices"),

  /**
   * Say we are still here.
   *
   * The same idempotent call as `register`, on a different occasion, and it
   * exists because registration happens ONCE per app start. A counter tablet
   * left open for a fortnight — which is the normal way a POS is used — would
   * otherwise sit on the owner's roster reading "last reached us 14 days ago"
   * the entire time it was syncing every quarter of an hour. The clock the
   * whole offline policy reads would be measuring how long since the browser
   * was last reloaded, which is not a fact about connectivity at all.
   *
   * Rate-limited rather than sent on every sync, because a cashier tabbing back
   * and forth triggers a pull each time and none of those need a second POST.
   */
  touch: (deviceId: string) => deviceService.register(deviceId),

  /**
   * Stop a till being used — the tablet that was lost.
   *
   * Not a delete on the server either: the sales it already sent still point at
   * it, and why it was signed out is what an owner reads afterwards.
   */
  revoke: (id: string) => apiDelete<PosDevice>(`/pos-devices/${id}`),

  /** Allow a signed-out till back. The tablet turned up. */
  restore: (id: string) => apiPost<PosDevice>(`/pos-devices/${id}/restore`, {}),

  /**
   * Name a till, from the office.
   *
   * Deliberately NOT `register(id, name)`. That call stamps `last_seen_at`,
   * and an owner labelling a tablet that has been switched off for a week
   * would write "reached us just now" onto exactly the device whose silence
   * the roster exists to show. This touches the name and nothing else.
   */
  rename: (id: string, name: string) => apiPatch<PosDevice>(`/pos-devices/${id}`, { name }),
};
