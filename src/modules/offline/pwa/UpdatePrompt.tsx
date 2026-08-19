import { useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

import { useOfflineStore } from "../offlineStore";
import { useReservesBottomRoom } from "./useReservesBottomRoom";

/**
 * "A new version is ready."
 *
 * The service worker is registered with `prompt` rather than `autoUpdate`, and
 * this is why: an automatic swap replaces the running app between one sale and
 * the next, with a customer at the counter and a half-rung cart on screen.
 * Worse, once the outbox exists, an update can change the local schema while
 * unsent sales are still queued — so the moment the app reloads has to be a
 * moment somebody chose.
 *
 * So this is a quiet, dismissible strip, not a modal. It never blocks the till,
 * it never reloads on its own, and dismissing it leaves the new version waiting
 * — the next natural reload picks it up regardless.
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // Deliberately silent on first install. "ShopOS is ready to work offline"
    // is a sentence that means nothing to a cashier and arrives at the one
    // moment they are busiest — their first day.
    onRegisteredSW() {},
    onRegisterError() {
      // A service worker that will not register is a till without an offline
      // shell. It still sells; it just needs a line. Nothing to say here.
    },
  });

  // Sales this till is still holding. An update reloads the app, and the one
  // thing a cashier standing over a queue of unsent sales will fear is that
  // reloading loses them. It does not — the outbox is in IndexedDB and every
  // upgrade step is additive, which the schema tests pin — so the strip says so
  // rather than leaving them to guess and put it off for a week.
  const owed = useOfflineStore((s) => s.pending);

  // Same as the install card: the page reserves room, so this never lands on
  // top of a control the shop needs. See useReservesBottomRoom.
  const card = useRef<HTMLDivElement>(null);
  useReservesBottomRoom(card);

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      ref={card}
      className="fixed inset-x-3 bottom-3 z-[999999] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-brand-500/30 bg-white p-3 shadow-theme-lg dark:border-brand-500/40 dark:bg-gray-900"
    >
      <span className="flex-1 text-theme-sm text-gray-700 dark:text-gray-200">
        A newer ShopOS is ready. Update between customers — nothing is lost
        either way.
        {owed > 0 && (
          <span className="mt-0.5 block text-theme-xs text-gray-500 dark:text-gray-400">
            The {owed} {owed === 1 ? "sale" : "sales"} saved on this till will
            still be here afterwards.
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        className="rounded-lg bg-brand-500 px-3 py-1.5 text-theme-xs font-medium text-white hover:bg-brand-600"
      >
        Update now
      </button>
      {/* No aria-label: "Later" already IS the accessible name, and an
          aria-label would override the visible word — leaving a screen reader
          and a sighted cashier being told two different things. */}
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        className="rounded-lg px-2 py-1.5 text-theme-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        Later
      </button>
    </div>
  );
}
