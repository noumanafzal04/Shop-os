import React from "react";
import { Linking } from "react-native";
import { resolveDeepLink } from "../navigation/deepLinks";

/**
 * Links that arrive from OUTSIDE the app — a shop or a dish someone sent a
 * friend in WhatsApp.
 *
 * Until this existed, `resolveDeepLink` had exactly one caller: a tapped push
 * notification. Everything else about deep linking was already built — the
 * route table, the pending-link replay — and a link tapped in a chat opened the
 * app on its home screen and did nothing, which looks like a broken link rather
 * than a missing listener.
 *
 * Both doors are needed and they are different doors:
 *   getInitialURL   the app was NOT running; the link is what launched it
 *   the "url" event the app was already open and moves to the link
 *
 * A link that arrives before navigation has mounted is queued by
 * `resolveDeepLink` and replayed by `flushPendingDeepLink`, which is the
 * ordinary case for a cold start — the OS hands over the URL well before the
 * container is ready.
 */
export function useAppLinks(): void {
  React.useEffect(() => {
    let alive = true;

    Linking.getInitialURL()
      .then((url) => {
        if (alive && url) resolveDeepLink(url);
      })
      // A launch URL the OS cannot hand over is not a reason to fail boot.
      .catch(() => {});

    const sub = Linking.addEventListener("url", ({ url }) => resolveDeepLink(url));

    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
}
