import { useCallback, useEffect, useRef, useState } from "react";

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
export type SyncPress = "idle" | "working" | "done" | "failed";

/** How long the answer stays on screen before the control goes quiet again. */
export const ANSWER_MS = 2500;

export function useManualSync(): { state: SyncPress; sync: () => void } {
  const [state, setState] = useState<SyncPress>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A press whose answer arrives after the till has moved on must not set state
  // on a screen that is gone, and a pending timer must not fire into it either.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const settle = useCallback((next: SyncPress) => {
    setState(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ANSWER_MS);
  }, []);

  const sync = useCallback(() => {
    // A sync is already running — the automatic one, or a double tap. Reflect it
    // rather than starting a second: `pullNow` is single-flight, so a second
    // press would return the SAME promise and the two answers would race.
    if (state === "working") return;

    setState("working");

    void pullNow().then(
      () => settle("done"),
      () => settle("failed"),
    );
  }, [state, settle]);

  return { state, sync };
}

/**
 * What the control says.
 *
 * Kept beside the hook rather than in the screen, for the reason the offline
 * pill had to learn the hard way: wording that lives in a component grows a
 * second copy in the next component that needs it, and the two drift.
 */
export function syncLabel(state: SyncPress, connected: boolean): string {
  switch (state) {
    case "working":
      return "Syncing…";
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
