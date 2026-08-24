import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

import { installRoute, isInstalled } from "./installable";
import { useReservesBottomRoom } from "./useReservesBottomRoom";

/**
 * "Put CartZe on this tablet."
 *
 * ── Why this is not a nicety ────────────────────────────────────────────
 *
 * An installed till opens from an icon, fills the screen with no address bar,
 * and — the part that actually matters — keeps its own service worker and
 * storage. A shop that runs the counter from a browser tab is one accidental
 * tab-close away from hunting for a URL with a customer waiting.
 *
 * ── Two devices, two conversations ──────────────────────────────────────
 *
 * Chrome and Android hand over a `beforeinstallprompt` event. We take it,
 * refuse the browser's own banner, and hold it — so the shop is asked at a
 * moment we chose, with a sentence that says what installing is FOR.
 *
 * Safari hands over nothing. An iPad can only be installed by a person tapping
 * Share and then Add to Home Screen, and no code can start that. Since a
 * counter tablet is very often an iPad, the device the shop most wants this on
 * is the one we can only give directions to. So it says where to tap.
 *
 * ── Where it does not appear ────────────────────────────────────────────
 *
 * Never on the till. The POS is full-bleed with a bar of actions along the
 * bottom edge, which is exactly where this strip lives — and nobody installs
 * an app with a customer at the counter. Same fence the Appearance canvas got,
 * for the same reason.
 *
 * Dismissal is remembered on the device, because a strip that returns every
 * morning is one a shop learns to swipe past without reading.
 */

const DISMISSED = "shopos-install-dismissed";

/** The Chromium event, which TypeScript's DOM lib does not describe. */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED) === "1",
  );
  // Re-read once on mount: a shop that installs the app while this tab is open
  // should not still be told to install it.
  const [installed, setInstalled] = useState(isInstalled);

  const onTill = useLocation().pathname.startsWith("/tenant/pos");

  // The page reserves room for this card, so nothing ends up underneath it.
  const card = useRef<HTMLDivElement>(null);
  useReservesBottomRoom(card);

  useEffect(() => {
    const onBefore = (e: Event) => {
      // Refusing the browser's own banner is the whole point of catching it:
      // it appears whenever Chrome feels like it, says nothing about why a
      // shop would want this, and cannot be brought back once dismissed.
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const route = installed ? "installed" : installRoute(deferred !== null);

  const close = () => {
    localStorage.setItem(DISMISSED, "1");
    setDismissed(true);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event is single-use either way. Keeping a spent one would leave a
    // button that silently does nothing.
    setDeferred(null);
    if (outcome === "accepted") setInstalled(true);
    else close();
  };

  if (onTill || dismissed || route === "installed" || route === "none") return null;

  return (
    <div
      ref={card}
      role="status"
      className="fixed inset-x-3 bottom-3 z-[99998] mx-auto flex max-w-md items-start gap-3 rounded-xl border border-brand-500/30 bg-white p-3 shadow-theme-lg dark:border-brand-500/40 dark:bg-gray-900"
    >
      <span className="flex-1 text-theme-sm text-gray-700 dark:text-gray-200">
        {route === "prompt" ? (
          <>
            Put CartZe on this device. It opens from an icon, fills the screen,
            and keeps working when the line drops.
          </>
        ) : (
          <>
            Put CartZe on this iPad: tap{" "}
            <span className="font-semibold">Share</span>, then{" "}
            <span className="font-semibold">Add to Home Screen</span>. It then
            opens from an icon and keeps working when the line drops.
            {/* Safari gives no event and no API. A person has to do it, so the
                only useful thing a screen can do is say exactly where. */}
          </>
        )}
      </span>

      {route === "prompt" && (
        <button
          type="button"
          onClick={() => void install()}
          className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-theme-xs font-medium text-white hover:bg-brand-600"
        >
          Install
        </button>
      )}
      {/* No aria-label: "Not now" already IS the accessible name, and an
          aria-label would override the visible words. */}
      <button
        type="button"
        onClick={close}
        className="shrink-0 rounded-lg px-2 py-1.5 text-theme-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        Not now
      </button>
    </div>
  );
}
