import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { useCan } from "../../stores/useCan";
import { useToast } from "../../components/ui/toast";
import { screenForLink } from "./deepLink";
import {
  enablePush,
  onNotificationClick,
  onPushMessage,
  pushState,
  takeLaunchLink,
  type PushState,
} from "../../services/webPush";

/**
 * ORDER ALERTS — the control, and the thing that listens.
 *
 * ── The problem, stated plainly ──────────────────────────────────────
 *
 * The orders list refreshes itself every thirty seconds, and the panel is an
 * installable app. Both of those require somebody to be LOOKING. A shop that
 * sells online cannot sit on a screen all day, and every minute an order waits
 * unaccepted is a minute the customer spends deciding they ordered from the
 * wrong place.
 *
 * ── Why the button, rather than asking on load ───────────────────────
 *
 * A browser asks for notification permission ONCE. A prompt that appears
 * unbidden on a page load is the prompt people dismiss, and a dismissal is
 * close to permanent — it cannot be asked again, only changed by hand in site
 * settings. So the request comes from a button, on the screen where the alerts
 * are about to matter, with the reason written next to it.
 */

/**
 * A short two-tone chime, synthesised.
 *
 * No audio file: one would be a network request that fails silently the first
 * time it is needed, and a shipped asset for two hundred milliseconds of
 * sound. WebAudio is already in every browser that can do notifications.
 *
 * Wrapped in try/catch and deliberately quiet on failure — a browser that
 * blocks audio until somebody has interacted with the page is the normal case,
 * not an error, and a silent alert is still an alert.
 */
function chime(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    gain.connect(ctx.destination);

    [880, 1320].forEach((hz, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.22);
    });

    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {
    // A silent alert is still an alert.
  }
}

/**
 * Mounted once, high in the tree. Listens whatever screen is showing, because
 * an order can arrive while somebody is on Products.
 */
export function OrderAlertsListener() {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useCan();

  // Where a notification wants to go — through the panel's OWN resolver, which
  // refuses to send anybody to a screen their permissions do not open. A
  // service worker could not have asked that question.
  useEffect(() => {
    const go = (link: string | null) => {
      const screen = screenForLink(link, can);
      if (screen !== null) navigate(screen);
    };

    // A cold start: no tab was open, the worker opened one at `/?n=…`.
    go(takeLaunchLink());

    return onNotificationClick(go);
  }, [can, navigate]);

  // A message that arrives while the panel is open. The browser draws nothing
  // in that case, on purpose — the app is on screen and knows better than the
  // OS what to do with it.
  useEffect(
    () =>
      onPushMessage((m) => {
        chime();
        // One line, because that is what the toast takes — and the body is
        // the part that says WHICH order.
        toast.info(m.body ? `${m.title} — ${m.body}` : m.title);

        // The list this is about is now stale. Refetching beats waiting out
        // the remainder of a thirty-second poll while a toast says an order
        // arrived and the table does not show it.
        if (m.type?.startsWith("order.")) {
          void queryClient.invalidateQueries({ queryKey: ["orders"] });
        }
      }),
    [queryClient, toast],
  );

  return null;
}

const COPY: Record<PushState, { title: string; body: string } | null> = {
  // Nothing to offer: this build has no Firebase project, so the feature does
  // not exist here rather than being switched off.
  unconfigured: null,
  granted: null,
  default: {
    title: "Get told when an order arrives",
    body: "Right now this page has to be open to see new orders. Turn on alerts and your phone will tell you.",
  },
  denied: {
    title: "Alerts are blocked for this site",
    body: "Your browser will not ask again. Allow notifications for this site in its settings, then reload.",
  },
  insecure: {
    title: "Alerts need a secure connection",
    body: "Notifications only work over https. Open the panel on its real address rather than an IP.",
  },
  unsupported: {
    title: "This browser cannot show alerts",
    body: "Try Chrome on Android, or install the panel to your home screen.",
  },
};

/** The control itself. Put it where the alerts will matter. */
export function OrderAlerts() {
  const toast = useToast();
  const [state, setState] = useState<PushState>(() => pushState());
  const [busy, setBusy] = useState(false);

  const copy = COPY[state];
  if (copy === null) return null;

  const ask = () => {
    setBusy(true);
    enablePush()
      .then((next) => {
        setState(next);
        if (next === "granted") toast.success("Alerts on for this device");
        else if (next === "denied") toast.error("Your browser blocked notifications");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-500/30 dark:bg-brand-500/10">
      <div className="min-w-0 flex-1">
        <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{copy.title}</p>
        <p className="text-theme-xs text-gray-600 dark:text-gray-300">{copy.body}</p>
      </div>
      {state === "default" && (
        <button
          className="shrink-0 rounded-xl bg-brand-500 px-4 py-2 text-theme-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
          disabled={busy}
          onClick={ask}
        >
          {busy ? "Asking…" : "Turn on alerts"}
        </button>
      )}
    </div>
  );
}
