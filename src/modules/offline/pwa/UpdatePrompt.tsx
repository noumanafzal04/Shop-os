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
      /**
       * STILL NOT A MODAL — but no longer easy to miss.
       *
       * The strip stays a strip: it never blocks the till, never reloads on its
       * own, and "Later" is a real answer. That decision is above and it stands.
       * What it cost was noticeability — a white card with a hairline border, at
       * the bottom of a dark, busy till, reads as furniture. It was reported as
       * exactly that.
       *
       * So the prominence comes from things that do not take the screen away:
       * a brand rail down the side, a real icon, a heading that says what this
       * IS in two words, the Modal's own lift (`shadow-2xl` + ring) instead of a
       * hairline, and one entrance movement. Nothing here interrupts, and
       * nothing here can swallow a tap meant for the cart.
       */
      className="rise-into-view fixed inset-x-3 bottom-3 z-[999999] mx-auto flex max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-brand-500/30 dark:bg-gray-900 dark:ring-brand-400/30"
    >
      {/* The rail. On a dark ground a border disappears and a coloured edge does
          not — the same reasoning that turned the product tiles into real white
          cards. */}
      <span aria-hidden="true" className="w-1.5 shrink-0 bg-brand-500" />

      <div className="flex flex-1 items-start gap-3 p-3.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"
        >
          {/* An arrow up, not a warning triangle. Nothing is wrong. */}
          <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
            <path d="M10 15V5m0 0l-4 4m4-4l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          {/* Two words first. A cashier glancing sideways mid-sale reads a
              heading; they do not read a sentence. */}
          <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
            Update ready
          </p>
          <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
            Install it between customers — nothing is lost either way.
          </p>
          {owed > 0 && (
            <p className="mt-1 text-theme-xs font-medium text-gray-600 dark:text-gray-300">
              The {owed} {owed === 1 ? "sale" : "sales"} saved on this till will
              still be here afterwards.
            </p>
          )}

          {/* Under the text, not beside it. Beside it, on a 390-point phone, the
              two buttons squeezed the sentence into four words a line. */}
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void updateServiceWorker(true)}
              /* `min-h-10`: this is a till, pressed with a thumb, and the old
                 buttons were about 30px tall — under the floor the browser
                 suite enforces for everything else on this screen. */
              className="min-h-10 rounded-lg bg-brand-500 px-4 text-theme-sm font-semibold text-white transition hover:bg-brand-600 active:bg-brand-700"
            >
              Update now
            </button>
            {/* No aria-label: "Later" already IS the accessible name, and an
                aria-label would override the visible word — leaving a screen
                reader and a sighted cashier being told two different things. */}
            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              className="min-h-10 rounded-lg px-3 text-theme-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
