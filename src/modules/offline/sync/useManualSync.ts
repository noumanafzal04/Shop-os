import { useCallback, useEffect, useRef, useState } from "react";

import { queueSummary } from "../outbox/outbox";
import { useAuthStore } from "../../../stores/authStore";
import { pullNow } from "./pullNow";

/**
 * "Sync now", as a person experiences it.
 *
 * ── Why a button needs more than the automatic sync has ─────────────────
 *
 * The till syncs on its own: when the line returns, every fifteen minutes, and
 * when the tab comes back on screen. None of that needs narrating, and the pill
 * deliberately says nothing while a queue is empty — announcing "Sending 0 of 0"
 * four times an hour teaches a cashier to stop reading it.
 *
 * A press is different. **Somebody asked a question and is owed an answer**, and
 * the commonest case is the one where the automatic sync would show nothing at
 * all: an empty queue, a catalog delta of zero rows, a request that takes 300ms.
 * Without a state of its own the button would look broken precisely when
 * everything is fine.
 *
 * That is why `isPulling` sat on the unreachable-exports list for weeks with
 * "needs a manual Sync now control" written against it. This is that control.
 *
 * ── Why it reports failure rather than swallowing it ────────────────────
 *
 * The automatic sync fails silently on purpose — a till must not interrupt a
 * queue of customers to say the line is still down, and the pill already says
 * so. But a person who pressed a button and got nothing back will press it
 * again, and again, with people waiting.
 */
export type SyncPress = "idle" | "working" | "done" | "failed" | "stuck";

/** What the press actually achieved, in the only terms a shop cares about. */
export interface SyncOutcome {
  /** Sales AND drawer events that reached the server on this press. */
  sent: number;
  /** Sales and drawer events this till is still holding afterwards. */
  waiting: number;
  /** Sales the shop refused — pressing again will not move these. */
  refused: number;
  /**
   * Sales held by the tenant fence: they name another shop, or name none.
   * Counted apart because pressing Sync will never move them and the old
   * control gave a shop no way to find that out.
   */
  stranded: number;
  /** The most recent reason, when there is one. */
  reason: string | null;
}

/** How long the answer stays on screen before the control goes quiet again. */
export const ANSWER_MS = 2500;

export function useManualSync(): { state: SyncPress; sync: () => void; outcome: SyncOutcome | null } {
  const [state, setState] = useState<SyncPress>("idle");
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A press whose answer arrives after the till has moved on must not set state
  // on a screen that is gone, and a pending timer must not fire into it either.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  /**
   * `hold` keeps the answer on screen instead of letting it expire.
   *
   * Proven against the deployed build: the stranded answer appeared 505ms
   * after the press and was gone 2,500ms later, and the badge went back to
   * reading "1 still to send" — the precise misleading sentence this whole
   * change exists to stop telling. For a queue that is merely waiting on a bad
   * line that is right, because the situation is temporary and the pill's own
   * label is true. A stranded row is neither: it is permanent until a person
   * acts, and pressing again cannot change it. So it stays up.
   */
  const settle = useCallback((next: SyncPress, hold = false) => {
    setState(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (hold) return;
    timer.current = setTimeout(() => setState("idle"), ANSWER_MS);
  }, []);

  const sync = useCallback(() => {
    // A sync is already running — the automatic one, or a double tap. Reflect it
    // rather than starting a second: `pullNow` is single-flight, so a second
    // press would return the SAME promise and the two answers would race.
    if (state === "working") return;

    setState("working");

    // FORCED, because a press is not a poll. The retry backoff caps at ten
    // minutes; without this a cashier who pressed Sync after four sales failed
    // got a flush that found nothing DUE, sent nothing, and reported success.
    void pullNow({ force: true }).then(
      async (result) => {
        // What the QUEUE did, asked after the flush rather than inferred from
        // the pull. "Up to date" used to be reported off the back of a catalog
        // pull that succeeded while the sales it had just failed to send sat
        // untouched — the till telling a shop its money had gone when it had
        // not is the one thing this control must never do.
        // The same counters the till badge reads, so the two numbers on that
        // bar cannot disagree — see queueSummary.
        const tenantId = useAuthStore.getState().user?.tenant?.id ?? null;
        const queue = await queueSummary(tenantId).catch(() => ({
          waiting: 0,
          failed: 0,
          stranded: 0,
          lastError: null as string | null,
        }));

        setOutcome({
          // BOTH QUEUES. `waiting` below is sales + drawer events, so `sent`
          // has to be too — otherwise a press that sent four shift events and
          // no sales reported "0 sent" while the waiting figure dropped by
          // four, and the two halves of one sentence disagreed.
          sent: result.flushed.acked + result.shifts.acked,
          waiting: queue.waiting,
          refused: queue.failed,
          stranded: queue.stranded,
          reason: queue.lastError,
        });

        settle(
          queue.waiting > 0 || queue.failed > 0 ? "stuck" : "done",
          // Held only for the case a person has to DO something about.
          queue.stranded > 0,
        );
      },
      () => {
        setOutcome(null);
        settle("failed");
      },
    );
  }, [state, settle]);

  return { state, sync, outcome };
}

/**
 * What the control says.
 *
 * Kept beside the hook rather than in the screen, for the reason the offline
 * pill had to learn the hard way: wording that lives in a component grows a
 * second copy in the next component that needs it, and the two drift.
 */
export function syncLabel(state: SyncPress, connected: boolean, outcome?: SyncOutcome | null): string {
  switch (state) {
    case "working":
      return "Syncing…";
    case "stuck": {
      // THE ANSWER THE OLD CONTROL COULD NOT GIVE.
      //
      // A shop sold four offline, pressed Sync, and read "Up to date" beside a
      // badge still showing four. Both were drawn by the same screen, one of
      // them was false, and the false one was the reassuring one.
      const held = (outcome?.waiting ?? 0) + (outcome?.refused ?? 0);
      // STUCK IS NOT THE SAME AS WAITING, and telling somebody to keep
      // pressing a button that can never work is the worse of the two. A
      // stranded row names another shop, or names none — the fence will hold
      // it however many times Sync is pressed, and a shop watched "7 still to
      // send" for days before anything said so.
      if ((outcome?.stranded ?? 0) > 0) {
        return `${outcome!.stranded} stuck — needs attention`;
      }
      if ((outcome?.refused ?? 0) > 0 && (outcome?.waiting ?? 0) === 0) {
        return `${outcome!.refused} refused — open the queue`;
      }

      return `${held} still to send`;
    }
    case "done":
      // Not "Synced!" — nothing here proves the shop's whole day went up, only
      // that this round finished. Overclaiming is how a cashier stops believing
      // the next message.
      return "Up to date";
    case "failed":
      // The pill already says whether there is a line. This says what the PRESS
      // did, which is the question that was asked.
      return connected ? "Sync failed" : "Still no connection";
    default:
      return "Sync now";
  }
}

/**
 * The sentence under the label — what the server or the line actually said.
 *
 * `queueSummary` has captured `lastError` since it was written, and nothing has
 * ever displayed it. That left the two cases a shopkeeper most needs to tell
 * apart looking identical: a queue held up by a bad connection, and a queue the
 * server is REFUSING. Both read "7 still to send", both survive any number of
 * presses, and only one of them is worth waiting out.
 *
 * A count with no reason beside it is what sends somebody to a phone call.
 */
export function syncDetail(state: SyncPress, outcome?: SyncOutcome | null): string | null {
  if (state !== "stuck" || !outcome) return null;

  if (outcome.stranded > 0) {
    // Never "try again" — pressing cannot move these, and saying so is the
    // whole point. The recovery lives in Settings, so the sentence points there.
    return "These name a different shop, or none at all, so the till will not send them. "
      + "Open Settings → Shop → Offline to see them.";
  }

  return outcome.reason ?? null;
}

/*
 * There was a `syncRunning(state)` here that OR-ed this hook's state with
 * `isPulling()`. It was deleted rather than shipped: `isPulling` reads a module
 * variable, which React does not subscribe to, so a component calling it during
 * render gets whatever happened to be true at the last render and never hears
 * when it changes. A control that reports "still syncing" and then stays that
 * way is worse than one that never claimed to know.
 *
 * `pullNow` is single-flight anyway — a press during an automatic pull joins the
 * one in progress rather than starting a second, which is the behaviour that
 * actually mattered.
 */
