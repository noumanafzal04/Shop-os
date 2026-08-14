import { useEffect } from "react";

import { useConnectionStore } from "../../../stores/connectionStore";
import { useOfflineStore } from "../offlineStore";
import { pullNow } from "./pullNow";

/**
 * Keeping the till's catalog current while it is open.
 *
 * Three triggers, and each exists for a different failure:
 *
 *  1. **Reconnecting.** The one that matters most. A till that was offline for
 *     an hour has an hour of price changes, new items and retired ones waiting,
 *     and the moment it can ask is the moment it should.
 *  2. **A slow heartbeat.** For the till that never disconnects and never
 *     reloads — a counter machine left on for a fortnight. Without it the
 *     catalog would only refresh when somebody happened to press F5.
 *  3. **Coming back to the tab.** A cashier returning after lunch is about to
 *     ring something up, and it is the cheapest possible moment to be current.
 *
 * Every one is fire-and-forget: `pullNow` de-duplicates overlapping calls, and
 * a pull that fails is not an event a cashier should be told about. It failed
 * because there is no connection, which the badge already says.
 */

/**
 * Fifteen minutes.
 *
 * Short enough that a price corrected at the office reaches the counter within
 * one customer's visit; long enough that a shop on a metered connection is not
 * paying for a poll every minute. Every request after the first is a delta, so
 * the usual cost is an empty answer.
 */
export const HEARTBEAT_MS = 15 * 60 * 1000;

export function useKeepInSync(enabled: boolean): void {
  const reachable = useConnectionStore((s) => s.reachable);
  const online = useConnectionStore((s) => s.online);
  const setPending = useOfflineStore((s) => s.setPending);
  const connected = online && reachable;

  // ── 1. Reconnected ────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !connected) return;

    void pullNow().catch(() => {});
  }, [enabled, connected]);

  // ── 2. Heartbeat ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      // Checked at fire time rather than in the dependency list, so the timer
      // is not torn down and rebuilt every time connectivity flickers — which
      // on a bad shop wifi would mean it never actually fired.
      if (useConnectionStore.getState().reachable) {
        void pullNow().catch(() => {});
      }
    }, HEARTBEAT_MS);

    return () => clearInterval(timer);
  }, [enabled]);

  // ── 3. Back on screen ─────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const onVisible = (): void => {
      if (document.visibilityState === "visible" && useConnectionStore.getState().reachable) {
        void pullNow().catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled]);

  // Keep the count the badge shows honest. It is read here rather than written
  // by the outbox itself so there is one place that decides when it refreshes.
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    void import("../db/repo")
      .then((repo) => repo.pendingCount())
      .then((n) => {
        if (!cancelled) setPending(n);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [enabled, connected, setPending]);
}
