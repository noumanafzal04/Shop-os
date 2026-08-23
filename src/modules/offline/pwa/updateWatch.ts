/**
 * ASKING WHETHER THERE IS A NEWER SHOPOS, MORE THAN ONCE.
 *
 * The service worker is registered with `prompt`, and the strip that offers the
 * update only appears when the browser has NOTICED a new version. The browser
 * notices on navigation — and a till is the one screen nobody navigates. It is
 * opened on Monday, stood on a counter, and used until Saturday.
 *
 * So a shop could sit on a build for a week with the update sitting on the
 * server, and the first sign of it would be somebody hitting reload for an
 * unrelated reason. That was reported as sizes not appearing on a screen that
 * had grown them four days earlier: the app was right, the copy of it in front
 * of the shopkeeper was old, and nothing had ever offered them the new one.
 *
 * This does NOT change what the strip decides — the reload still happens only
 * when a person presses the button, mid-shift is still theirs to refuse. It
 * only makes sure the offer reaches them.
 *
 * Offline, the check is skipped rather than attempted: `update()` on a dead
 * line is a rejected promise per hour, and a till with no network is precisely
 * the one this must not add noise to.
 */

/** Once an hour. Long enough to be invisible, short enough that a day is not lost. */
export const CHECK_EVERY_MS = 60 * 60 * 1000;

interface Updatable {
  update: () => Promise<unknown>;
}

/**
 * Poll a service-worker registration for a newer build.
 *
 * Returns the stop function. `isOnline` is injected rather than read from
 * `navigator` so the caller — and the test — can say what "connected" means;
 * this codebase has been bitten before by `navigator.onLine` being answered
 * differently by jsdom than by a browser.
 */
export function watchForUpdates(
  registration: Updatable | undefined,
  { every = CHECK_EVERY_MS, isOnline = () => navigator.onLine }: {
    every?: number;
    isOnline?: () => boolean;
  } = {},
): () => void {
  if (!registration) return () => {};

  const timer = setInterval(() => {
    if (!isOnline()) return;

    // A failed check is not an event. The next one is an hour away and the
    // strip appears the moment one succeeds.
    void registration.update().catch(() => {});
  }, every);

  return () => clearInterval(timer);
}
