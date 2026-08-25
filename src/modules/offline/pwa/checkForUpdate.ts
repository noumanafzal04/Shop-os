/**
 * GOING AND ASKING, BECAUSE SOMEBODY PRESSED A BUTTON.
 *
 * `updateWatch` already asks once an hour, which is the right cadence for
 * something nobody should have to think about. It leaves two gaps, and this
 * closes both:
 *
 *  - **Up to an hour of not knowing.** A shop told "the new prices are live"
 *    has no way to go and get them; they can only wait, or reload and hope.
 *  - **"Later" is a one-way door.** Dismissing the update strip leaves the new
 *    version waiting with nothing on screen offering it any more.
 *
 * What it must never do is lie. Every branch below returns a DIFFERENT answer,
 * because "no update found" and "I could not look" are not the same sentence
 * and a shopkeeper acts differently on each.
 */

/** Just enough of a registration to ask. Narrow, so a test needs no browser. */
export interface CheckableRegistration {
  update: () => Promise<unknown>;
  waiting: unknown;
  installing: unknown;
}

export type UpdateCheck =
  /** A newer build is downloaded and waiting. */
  | "found"
  /** One is on its way down; the strip will offer it shortly. */
  | "installing"
  /** Asked, answered, nothing newer. */
  | "current"
  /** No line. Not asked — see below. */
  | "offline"
  /** No service worker at all, so this copy cannot be updated in place. */
  | "unavailable"
  /** Asked and the ask failed. */
  | "failed";

/** How long to wait for a worker that is downloading before saying so. */
export const INSTALL_GRACE_MS = 6000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function checkForUpdate(
  registration: CheckableRegistration | undefined,
  {
    isOnline = () => navigator.onLine,
    grace = INSTALL_GRACE_MS,
    step = 250,
    wait = sleep,
  }: {
    isOnline?: () => boolean;
    grace?: number;
    step?: number;
    wait?: (ms: number) => Promise<unknown>;
  } = {},
): Promise<UpdateCheck> {
  // NO WORKER, NO UPDATE PATH. This is the state on a plain-http address,
  // where a browser refuses to register one at all — and telling that shop
  // "you are on the latest version" would be a guess dressed as a fact.
  if (!registration) return "unavailable";

  // Asked and skipped, not attempted: `update()` on a dead line is a rejected
  // promise, and "failed" is the wrong word for a till that simply has no
  // internet right now.
  if (!isOnline()) return "offline";

  try {
    await registration.update();
  } catch {
    return "failed";
  }

  if (registration.waiting) return "found";

  // A new worker was found and is downloading. Wait a little — on a shop's
  // connection this is usually a second or two — and if it lands, say so
  // properly rather than reporting "up to date" about a build already on the
  // way in.
  if (registration.installing) {
    for (let waited = 0; waited < grace; waited += step) {
      await wait(step);
      if (registration.waiting) return "found";
      if (!registration.installing) break;
    }

    return registration.waiting ? "found" : "installing";
  }

  return "current";
}
