import { deviceId } from "./deviceId";
import { deviceService } from "./deviceService";

/**
 * Telling the server this till is still here, at most this often.
 *
 * ── Why a touch is needed at all ────────────────────────────────────────
 *
 * Registration runs once, on the way in. A POS is not used that way: a counter
 * tablet is opened on Monday and is still on the same tab on Friday, syncing
 * its catalog every fifteen minutes the whole time. With only the boot to go
 * on, `last_seen_at` measures TIME SINCE THE BROWSER WAS RELOADED and nothing
 * else — so the owner's roster reads "last reached us 4 days ago" beside a till
 * that is demonstrably reaching us, and the clock the offline policy is built
 * on is measuring the wrong thing entirely.
 *
 * ── Why it is rate-limited ──────────────────────────────────────────────
 *
 * It rides the catalog pull, and a pull fires whenever the tab becomes visible.
 * A cashier moving between tabs would otherwise post a touch every few seconds.
 * Five minutes keeps `last_seen_at` accurate to well inside the coarsest
 * question anyone asks of it — which is measured in days — for at most one small
 * request per five minutes.
 */
export const TOUCH_EVERY_MS = 5 * 60 * 1000;

/**
 * Per tab, and reset by a reload — which registers on its own way in anyway.
 *
 * Starts at negative infinity rather than 0, because 0 is a real instant and
 * "we have never touched" is not a time at all. Any finite sentinel makes the
 * first touch depend on where the clock happens to start.
 */
let lastTouch = Number.NEGATIVE_INFINITY;

export function resetTouchClock(): void {
  lastTouch = Number.NEGATIVE_INFINITY;
}

/**
 * Record that the server has just heard from us by some other route.
 *
 * The boot registers and then immediately pulls, and the pull would otherwise
 * touch a device that had announced itself half a second earlier — two
 * identical requests on the slowest moment of the app's life.
 */
export function markTouched(now: number = Date.now()): void {
  lastTouch = now;
}

/**
 * Touch if it is time. Never throws.
 *
 * The clock advances only on SUCCESS. A touch that failed did not tell the
 * server anything, and skipping the next five minutes because of it would turn
 * one lost request into ten minutes of a till looking out of contact.
 */
export async function touchIfDue(now: number = Date.now()): Promise<boolean> {
  if (now - lastTouch < TOUCH_EVERY_MS) return false;

  try {
    await deviceService.touch(deviceId());
    lastTouch = now;

    return true;
  } catch {
    // Offline, or refused. The pull it rode in on is not this call's business.
    return false;
  }
}
