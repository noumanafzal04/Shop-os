import { Platform } from "react-native";
import { apiDelete, apiPost } from "../common/api/client";
import { resolveDeepLink } from "../navigation/deepLinks";

/**
 * FCM push wiring. Every backend notification carries `data.link`
 * ("orders/{id}", "announcements/{id}", …) — a tap deep-links straight to
 * the right screen.
 *
 * Firebase is OPTIONAL at build time: `@react-native-firebase/messaging`
 * is loaded dynamically, so the app runs fine before Firebase is
 * configured (see docs/FCM-SETUP.md). Once the package + config files are
 * in place, this activates with no code changes.
 */

type Unsubscribe = () => void;

let currentToken: string | null = null;
let subscriptions: Unsubscribe[] = [];

function loadMessaging(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("@react-native-firebase/messaging").default;
  } catch {
    return null; // Firebase not installed/configured yet — push stays off.
  }
}

/** Call after login: permission → token → register with the backend. */
export async function initPush(): Promise<void> {
  const messaging = loadMessaging();
  if (!messaging) {
    if (__DEV__) console.log("[push] firebase messaging not installed — skipping");
    return;
  }

  try {
    const authStatus = await messaging().requestPermission();
    const enabled = authStatus === 1 || authStatus === 2; // AUTHORIZED | PROVISIONAL
    if (!enabled) return;

    const token: string = await messaging().getToken();
    currentToken = token;
    await apiPost("/devices", { token, platform: Platform.OS === "ios" ? "ios" : "android" });

    subscriptions.push(
      // Token rotation — keep the backend pointing at this device.
      messaging().onTokenRefresh(async (next: string) => {
        currentToken = next;
        await apiPost("/devices", { token: next, platform: Platform.OS === "ios" ? "ios" : "android" }).catch(() => {});
      }),
      // App in background → user taps the notification.
      messaging().onNotificationOpenedApp((msg: { data?: { link?: string } }) => {
        resolveDeepLink(msg?.data?.link);
      }),
    );

    // App was QUIT and opened from a notification.
    const initial = await messaging().getInitialNotification();
    if (initial?.data?.link) resolveDeepLink(initial.data.link as string);
  } catch (e) {
    if (__DEV__) console.warn("[push] init failed", e);
  }
}

/** Call on logout: stop listeners and unregister the device token. */
export async function teardownPush(): Promise<void> {
  subscriptions.forEach((off) => off());
  subscriptions = [];
  if (currentToken) {
    await apiDelete("/devices", { data: { token: currentToken } }).catch(() => {});
    currentToken = null;
  }
}
