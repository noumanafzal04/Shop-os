import { useEffect, useState } from "react";
import { ApiError } from "../types/api";
import { UNSAID_WAIT_SECONDS } from "./failureWords";

/**
 * SECONDS LEFT BEFORE A THROTTLED WRITE MAY BE TRIED AGAIN (next rounds #31).
 *
 * A 429 said "Too Many Attempts." and left the button pressable at once — so
 * the only thing the screen invited was another press into the same throttle,
 * which pushed the window out further. The wait the server named (Retry-After,
 * carried as `retry_after` by failureWords) is counted down here, and a screen
 * holds its button until it reaches 0. 0 when there is nothing to wait for.
 */
export function useCoolDown(error: unknown): number {
  return useCoolDownState(error).left;
}

/**
 * The same count, and whether it has run out (#AZ3) — so a screen whose words
 * named the wait can stop naming it. The sign-in screen said "wait 53 seconds"
 * and still said 53 three seconds later, with its button live.
 */
export function useCoolDownState(error: unknown): { left: number; over: boolean } {
  const [left, setLeft] = useState(0);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const seconds = error instanceof ApiError && error.status === 429 ? (error.figure("retry_after") ?? UNSAID_WAIT_SECONDS) : 0;
    if (seconds <= 0) return;
    const until = Date.now() + seconds * 1000;
    const tick = () => {
      const now = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(now);
      if (now === 0) setOver(true);
    };
    const first = window.setTimeout(tick, 0);
    const every = window.setInterval(tick, 1000);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      setLeft(0);
      setOver(false);
    };
  }, [error]);

  return { left, over };
}
