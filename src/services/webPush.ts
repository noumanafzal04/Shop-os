import { apiDelete, apiPost } from "../common/api/client";

/**
 * PUSH FOR THE PANEL — so a shop learns about an order with the phone in a
 * pocket.
 *
 * ── The gap this closes ──────────────────────────────────────────────
 *
 * The panel is an installable PWA and the orders list refreshes itself every
 * thirty seconds. Both of those need somebody LOOKING at it. A shop that sells
 * online cannot sit on a screen all day, and every minute an order waits
 * unaccepted is a minute the customer is deciding they ordered from the wrong
 * place.
 *
 * ── Why Firebase and not the raw Web Push API ────────────────────────
 *
 * Raw Web Push means VAPID keys and encrypting each payload with aes128gcm on
 * the server — a second delivery path to build and keep working. The backend
 * already speaks FCM HTTP v1 for the mobile app, `device_tokens.platform`
 * already accepts `web`, and an FCM web token is just another token to it. One
 * sender, three platforms, no new backend at all.
 *
 * ── Dormant without config ───────────────────────────────────────────
 *
 * Everything here is a no-op until `VITE_FIREBASE_PROJECT_ID` is set. The
 * panel builds, installs and runs exactly as before; the moment the config
 * lands, alerts start working with no code change. (The mobile app has the
 * same arrangement for the same reason — see `mobile/docs/FCM-SETUP.md`.)
 *
 * ── And why nothing here asks for permission on its own ──────────────
 *
 * A notification prompt on page load is the prompt everybody blocks, and a
 * browser only asks ONCE — a refusal is close to permanent and cannot be
 * re-prompted. So permission is requested from a button somebody pressed, on
 * the screen where the alerts will actually matter.
 */

const CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

export type PushState =
  /** No Firebase config in this build — the feature does not exist here. */
  | "unconfigured"
  /** This browser cannot do it (no service workers, or an iOS home-screen-only case). */
  | "unsupported"
  /** Not a secure context. A service worker never registers over plain http. */
  | "insecure"
  /** Never asked. */
  | "default"
  | "granted"
  /** Refused. A browser will not ask again; the person must change it in site settings. */
  | "denied";

/** What this browser currently is, without asking anybody anything. */
export function pushState(): PushState {
  if (!CONFIG.projectId || !VAPID_KEY) return "unconfigured";
  if (typeof window === "undefined") return "unsupported";
  // `isSecureContext` covers localhost as well as https, which is exactly the
  // rule service workers use.
  if (!window.isSecureContext) return "insecure";
  /**
   * `typeof`, not `in`.
   *
   * `"Notification" in window` is TRUE when the key exists holding `undefined`
   * — which is what an embedded webview and some older Safaris present — and
   * the next line then reads `.permission` off nothing and throws. From inside
   * a button somebody pressed, that is a dead control with an exception behind
   * it rather than the sentence explaining their browser cannot help.
   */
  if (typeof window.Notification === "undefined") return "unsupported";
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return "unsupported";

  return window.Notification.permission as PushState;
}

/** The current token, if this browser has one. Kept so logout can remove it. */
let currentToken: string | null = null;

/**
 * Ask, get a token, and tell the server.
 *
 * Returns the state afterwards so a caller can say what happened rather than
 * guessing. Never throws: a shop pressing "turn on alerts" and getting an
 * exception is worse than one getting "not supported on this browser".
 */
export async function enablePush(): Promise<PushState> {
  const before = pushState();
  if (before === "unconfigured" || before === "unsupported" || before === "insecure") {
    return before;
  }

  try {
    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();

    if (permission !== "granted") return permission as PushState;

    // Registered with the config on the query string: a worker cannot read
    // `import.meta.env`, and baking the project into a committed static file
    // means editing that file to change environments.
    const params = new URLSearchParams(
      Object.entries(CONFIG).filter(([, v]) => typeof v === "string") as [string, string][],
    );
    const registration = await navigator.serviceWorker.register(
      `/firebase-messaging-sw.js?${params.toString()}`,
    );

    const { initializeApp } = await import("firebase/app");
    const { getMessaging, getToken, onMessage } = await import("firebase/messaging");

    const app = initializeApp(CONFIG as Record<string, string>, "cartze-push");
    const messaging = getMessaging(app);

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) return "denied";

    currentToken = token;
    await apiPost("/devices", { token, platform: "web" });

    /**
     * A message that arrives while the panel is OPEN.
     *
     * The browser draws nothing in this case — that is by design, because the
     * app is on screen and knows better than the OS what to do. So this hands
     * it to whoever asked to listen, and the orders screen turns it into a
     * toast and a sound rather than a system notification the person is
     * already looking at the answer to.
     */
    onMessage(messaging, (payload) => {
      const data = (payload.data ?? {}) as Record<string, string>;
      const n = payload.notification ?? {};
      for (const listener of listeners) {
        listener({
          title: n.title ?? data.title ?? "CartZe",
          body: n.body ?? data.body ?? "",
          type: data.type ?? null,
          link: data.link ?? null,
        });
      }
    });

    return "granted";
  } catch {
    // A blocked worker, a browser that lies about support, a network failure
    // fetching the token. None of it is worth an error screen on a page about
    // something else.
    return pushState();
  }
}

/** This device stops getting alerts. Called on sign-out. */
export async function disablePush(): Promise<void> {
  if (currentToken === null) return;
  const token = currentToken;
  currentToken = null;
  await apiDelete("/devices", { data: { token } }).catch(() => {});
}

// ── Foreground messages ─────────────────────────────────────────────

export interface PushMessage {
  title: string;
  body: string;
  type: string | null;
  link: string | null;
}

const listeners = new Set<(m: PushMessage) => void>();

/** Listen while the panel is open. Returns the unsubscribe. */
export function onPushMessage(fn: (m: PushMessage) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * A TAP ON A NOTIFICATION THAT FOUND THIS TAB ALREADY OPEN.
 *
 * The worker focuses the existing window rather than opening a second copy of
 * the panel — a shop with the orders list open should not end up with two —
 * and posts the link across so the app can navigate. Without this the tab
 * comes to the front showing whatever it was showing.
 */
export function onNotificationClick(fn: (link: string | null) => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }

  const handler = (event: MessageEvent) => {
    if (event.data?.kind === "cartze:notification-click") {
      fn(event.data.link ?? null);
    }
  };

  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}

/**
 * The link a COLD start arrived with.
 *
 * When no tab was open the worker opens one at `/?n=orders/8f2`. Read once and
 * removed from the address bar, so a refresh does not navigate again and a
 * copied URL does not carry somebody else's notification.
 */
export function takeLaunchLink(): string | null {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const link = url.searchParams.get("n");
  if (link === null) return null;

  url.searchParams.delete("n");
  window.history.replaceState({}, "", url.toString());

  return link;
}
