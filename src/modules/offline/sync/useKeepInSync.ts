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
  const setTally = useOfflineStore((s) => s.setTally);
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
  //
  // ── AND IT REFRESHES WHEN THE QUEUE DRAINS, which it did not ──────────
  //
  // The dependencies were `[enabled, connected]`. Neither of those moves when a
  // flush finishes — the till was already connected; that is why the flush ran
  // — so the count was last read BEFORE the sales went, and stayed there.
  //
  // What a shop saw: the line comes back, the pill says "Sending 1 of 1", the
  // sale reaches the server and is acked, and the pill then settles on **"1
  // still to send"** and stays there for the rest of the shift. The one moment
  // this badge exists for — the day's takings going up after an outage — ended
  // with it reporting that they had not. Measured in a browser: the row was
  // `acked` with an invoice number eight seconds in, and the pill was still
  // saying "1 still to send" a minute later.
  //
  // `syncing` is the transition that means the queue moved: null → {sent,total}
  // while it sends, back to null in `pullNow`'s `finally`, by which time the
  // rows are marked. Depending on it recounts at exactly that moment, and
  // nowhere else — a flush with nothing owed never sets it, so an idle till
  // still does not re-read IndexedDB every quarter hour for an answer that
  // cannot have changed.
  const syncing = useOfflineStore((s) => s.syncing);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    void import("../db/repo")
      .then((repo) => repo.queueTally())
      .then((tally) => {
        if (!cancelled) setTally(tally);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [enabled, connected, syncing, setTally]);
}
