import { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

import { useUpdateStore } from "./updateStore";
import { watchForUpdates } from "./updateWatch";

/**
 * REGISTERS THE SERVICE WORKER, ONCE, FOR THE WHOLE CONSOLE.
 *
 * `useRegisterSW` may be called exactly once — a second call registers the
 * worker again — so one component owns it and publishes what it learns to
 * `updateStore`. Everything else reads that.
 *
 * ── Why it is not inside the update strip any more ─────────────────────
 *
 * It used to be, and the strip is mounted shop-side only, which was fine while
 * the strip was the only thing that cared. The moment the header grew a "check
 * for updates" button the split became a lie: on the admin console there was no
 * registration to ask, so the button answered "this copy cannot update itself"
 * — about an app that updates itself perfectly well — every single time.
 *
 * ── Why it is not at the app root either ───────────────────────────────
 *
 * The root includes the landing page, and registering there would precache
 * megabytes of console for a stranger who came to read a page about a till,
 * on their own mobile data. It lives in `AppLayout`: both consoles, nobody
 * who has not signed in.
 *
 * It renders nothing. The offer to reload is `UpdatePrompt`'s job, and the
 * reload itself only ever happens because a person pressed something.
 */
export default function ServiceWorkerHost() {
  const stopWatching = useRef<(() => void) | null>(null);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // Deliberately silent on first install. "CartZe is ready to work offline"
    // is a sentence that means nothing to a cashier and arrives at the one
    // moment they are busiest — their first day.
    //
    // What it DOES do is keep asking. A browser looks for a new worker when the
    // page is navigated, and the till is the one screen nobody navigates — it
    // is opened on Monday and used until Saturday. Without this the strip could
    // not appear on the screen it matters most on. See `updateWatch`.
    onRegisteredSW(_swUrl, registration) {
      stopWatching.current?.();
      stopWatching.current = watchForUpdates(registration);
      useUpdateStore.getState().publish({ registration });
    },
    onRegisterError() {
      // A service worker that will not register is a till without an offline
      // shell. It still sells; it just needs a line. The header says as much
      // if anybody asks it, which is the only place it matters.
    },
  });

  // Cleared when the component goes, so a remount does not stack watchers.
  useEffect(() => () => stopWatching.current?.(), []);

  useEffect(() => {
    useUpdateStore.getState().publish({
      ready: needRefresh,
      apply: needRefresh ? () => void updateServiceWorker(true) : null,
    });
  }, [needRefresh, updateServiceWorker]);

  return null;
}
