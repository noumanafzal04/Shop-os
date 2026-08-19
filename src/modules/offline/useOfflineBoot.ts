import { useEffect, useRef } from "react";

import { ApiError } from "../../common/types/api";
import { pendingCount, putSingleton } from "./db/repo";
import { STORE } from "./db/schema";
import { deviceId } from "./device/deviceId";
import { deviceService } from "./device/deviceService";
import { markTouched } from "./device/touch";
import { pruneAcked, recoverInFlight } from "./outbox/outbox";
import { pullNow } from "./sync/pullNow";
import { useOfflineStore } from "./offlineStore";
import { checkStorage } from "./storage/persist";

/**
 * Everything the till does once, on the way in.
 *
 * Four things, in an order chosen so a failure in one never stops the next:
 *
 *   1. read this device's id — synchronous, and cannot fail
 *   2. ask the browser to keep our data, and how much room is left
 *   3. count what is already waiting to be sent
 *   4. announce this till to the server, and learn the shop's window
 *
 * Step 4 is the only one that needs a network, and it is deliberately LAST. A
 * till with no line still knows who it is, still knows whether its storage is
 * safe, and still knows how many sales it is holding — which is exactly the
 * information a cashier needs when the internet is the thing that is broken.
 *
 * Nothing here throws. A boot that crashes on a storage query or a failed
 * registration is a till that will not open, and a till that will not open is
 * worse in every way than one that opens knowing less.
 *
 * ── Why there is no "cancelled" flag ────────────────────────────────────
 *
 * The obvious shape — set `cancelled` in the cleanup and check it before every
 * write — is wrong here, and wrong in a way that only shows up under
 * StrictMode. React runs each effect, tears it down, then runs it again; the
 * teardown cancels the first boot, and the ref below correctly stops the second
 * from starting. The result is a till that registers exactly zero times, in
 * development, silently.
 *
 * The flag is not needed anyway. Every write goes to a global zustand store,
 * not to component state, so a write arriving after this hook unmounts is
 * simply a store update — there is nothing to leak and nothing to warn about.
 */
/**
 * A refusal worth repeating, or nothing.
 *
 * Only a 409 qualifies. Everything else registration can fail with is either a
 * dead line — which the offline badge already says, in the cashier's words —
 * or a bug, and neither belongs on an owner's roster as an explanation.
 *
 * The two real ones both come from the server with a sentence already written
 * for a human ("This till was signed out by the shop owner", "That device is
 * registered to another shop"), so it is passed through rather than restated
 * here: one wording, on the server, where the rule lives.
 */
export function refusalFrom(error: unknown): string | null {
  return error instanceof ApiError && error.status === 409 ? error.message : null;
}

export function useOfflineBoot(enabled: boolean): void {
  const setDevice = useOfflineStore((s) => s.setDevice);
  const setRegistered = useOfflineStore((s) => s.setRegistered);
  const setPolicy = useOfflineStore((s) => s.setPolicy);
  const setStorage = useOfflineStore((s) => s.setStorage);
  const setPending = useOfflineStore((s) => s.setPending);
  const refreshHoursOffline = useOfflineStore((s) => s.refreshHoursOffline);

  // Once per mounted session. Registering twice does no harm on the server —
  // it is idempotent — but a second round trip on every re-render would be a
  // request per keystroke on a slow connection, and StrictMode would double
  // every boot in development.
  const booted = useRef(false);

  useEffect(() => {
    if (!enabled || booted.current) return;
    booted.current = true;

    const boot = async (): Promise<void> => {
      setDevice(deviceId());

      // Storage first, and independent of the network: whether this browser
      // will keep unsent sales is the one question whose answer changes what a
      // shop should do BEFORE it starts selling.
      try {
        setStorage(await checkStorage());
      } catch {
        // checkStorage already swallows; this is belt and braces so a future
        // change in there can never take the boot down with it.
      }

      // BEFORE anything counts or sends. Every row left SENDING is a sale
      // whose fate nobody knows — the tab was closed or the battery died
      // mid-request — and left alone it is never sent again. The only safe
      // assumption is that it did not arrive; the duplicate that may cause is
      // absorbed by the server's idempotency key.
      try {
        await recoverInFlight();
        await pruneAcked();
      } catch {
        // No database, or a browser that refuses one. The till still opens.
      }

      try {
        setPending(await pendingCount());
      } catch {
        // No database yet, or a browser that refuses one. The till still works;
        // it simply cannot say how much it is holding, which is the truth.
      }

      try {
        const registered = await deviceService.register(deviceId());
        setRegistered(true);

        // The four characters this till prints in the middle of an offline
        // slip. Kept on the device so a till with no line can still mint a
        // number: the allocation happens once, here, and every offline sale
        // afterwards reads it locally. Null from a server too old to allocate,
        // in which case the till goes on slicing its own id as it always did.
        const code = registered?.data?.code ?? null;
        if (code) {
          await putSingleton(STORE.DEVICE, { code });
        }
        // The pull below would otherwise touch a device that announced itself
        // half a second ago — two identical requests at the slowest moment of
        // the app's life.
        markTouched();
      } catch (error) {
        // Offline, or refused. Neither stops the till: this is the
        // announcement, not the permission.
        //
        // But the two are different things to be told. "No connection" needs no
        // words — the offline badge already says it. A REFUSAL has a cause and
        // a remedy, and dropping it is how an owner ends up reading "No tills
        // yet" about a device that is right there, announcing itself, and being
        // turned away every single boot.
        setRegistered(false, refusalFrom(error));
      }

      // Either way the contact clock has moved — a success stamped it through
      // the interceptor, a failure did not — so re-read it rather than leave a
      // warning on screen that the last request just disproved.
      refreshHoursOffline();

      // The shop's ceiling is a separate call because it needs a permission the
      // cashier may not hold. A cashier simply never learns the number, which
      // is fine — nothing they can do depends on it until Phase 3.
      try {
        const { data } = await deviceService.list();
        setPolicy(data.offline_days);
      } catch {
        setPolicy(null);
      }

      // Last, and allowed to fail: a first load is a whole catalog, and a till
      // that would not open until it finished downloading one would be useless
      // on the morning it matters. Offline, this simply rejects and the till
      // carries on with whatever it already holds.
      void pullNow().catch(() => {});
    };

    void boot();
  }, [enabled, setDevice, setRegistered, setPolicy, setStorage, setPending, refreshHoursOffline]);
}
