import { PermissionsAndroid, Platform } from "react-native";
import {
  AuthorizationStatus,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
} from "@react-native-firebase/messaging";
import { apiDelete, apiPost } from "../common/api/client";
import { resolveDeepLink } from "../navigation/deepLinks";

/**
 * PUSH, FOR THE PERSON WHO ORDERED.
 *
 * Every backend notification carries `data.link` ("orders/{id}",
 * "announcements/{id}", …) and a tap deep-links straight to that screen.
 *
 * ── Why this file was rewritten ──────────────────────────────────────
 *
 * It used to load `@react-native-firebase/messaging` through a `require` in a
 * try/catch, with a comment promising that "once the package + config files
 * are in place, this activates with no code changes". The package was never
 * added to this app. So `loadMessaging()` returned null on every run, `initPush`
 * returned immediately, and the customer app has never sent a push — while the
 * code read as though push were merely waiting to be switched on.
 *
 * That is the shape this codebase keeps paying for: a promise written in one
 * file and kept in none. The dynamic require is gone; the dependency is real
 * and a missing config file is now a BUILD failure rather than a silent no-op
 * on somebody's phone.
 *
 * ── And the permission that was never asked for ──────────────────────
 *
 * On Android 13 and later a notification is dropped until the person has been
 * asked — and `requestPermission()` from the SDK does not raise the OS dialog
 * on Android. It is an iOS call that returns AUTHORIZED on Android whether or
 * not the runtime permission exists. The old code trusted its answer, and
 * `POST_NOTIFICATIONS` was not even declared in the manifest, so the two
 * defects hid each other perfectly: the app was sure push was on, the phone
 * dropped every message, and nothing said why.
 */

type Unsubscribe = () => void;

let currentToken: string | null = null;
let subscriptions: Unsubscribe[] = [];

const platform = () => (Platform.OS === "ios" ? "ios" : "android");

/**
 * Ask, the way the platform actually requires.
 *
 * Below Android 33 the permission does not exist and installing grants it.
 * On iOS the SDK call is the right one.
 */
export async function askForNotifications(): Promise<boolean> {
  if (Platform.OS === "android") {
    if (typeof Platform.Version === "number" && Platform.Version < 33) return true;

    const result = await PermissionsAndroid.request(
      "android.permission.POST_NOTIFICATIONS" as Parameters<typeof PermissionsAndroid.request>[0],
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  const status = await requestPermission(getMessaging());
  return status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;
}

/**
 * Call after login: permission → token → register with the backend.
 *
 * AFTER sign-in, never before — the register call needs a session, and a token
 * registered against nobody is a push nobody receives.
 */
export async function initPush(): Promise<void> {
  try {
    const allowed = await askForNotifications();
    if (!allowed) return;

    const messaging = getMessaging();
    const token = await getToken(messaging);
    currentToken = token;
    await apiPost("/devices", { token, platform: platform() });

    subscriptions.push(
      // Token rotation — keep the backend pointing at this device.
      onTokenRefresh(messaging, (next: string) => {
        currentToken = next;
        void apiPost("/devices", { token: next, platform: platform() }).catch(() => {});
      }),
      /**
       * The app is OPEN when a push arrives.
       *
       * Android draws nothing itself in this case. Registering the listener
       * keeps the message from being dropped on the floor and gives a later
       * in-app banner somewhere to hang; the deep link still only fires on a
       * real tap, because moving somebody's screen under them while they are
       * using the app is not a notification, it is a hijack.
       */
      onMessage(messaging, () => {}),
      // App in background → the person taps the notification.
      onNotificationOpenedApp(messaging, (msg) => {
        const link = msg?.data?.link;
        if (typeof link === "string") resolveDeepLink(link);
      }),
    );

    /**
     * TAPPED WHILE THE APP WAS NOT RUNNING AT ALL.
     *
     * A separate call, and the one people forget. `onNotificationOpenedApp`
     * fires only when the process already existed; a phone that was asleep
     * with the app killed delivers the tap here instead, once, at startup.
     * Without it the commonest tap of all opens the home screen and the order
     * is never found.
     */
    const initial = await getInitialNotification(messaging);
    const initialLink = initial?.data?.link;
    if (typeof initialLink === "string") resolveDeepLink(initialLink);
  } catch (e) {
    if (__DEV__) console.warn("[push] init failed", e);
  }
}

/**
 * Call on logout: stop listeners and unregister the device token.
 *
 * Without it a shared phone keeps ringing for the last person's orders — and
 * the notification names them, which makes it a leak rather than an annoyance.
 */
export async function teardownPush(): Promise<void> {
  subscriptions.forEach((off) => off());
  subscriptions = [];
  if (currentToken) {
    await apiDelete("/devices", { data: { token: currentToken } }).catch(() => {});
    currentToken = null;
  }
}
