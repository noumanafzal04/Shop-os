import { PermissionsAndroid, Platform } from "react-native";
import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  getInitialNotification,
  requestPermission,
} from "@react-native-firebase/messaging";
import { apiDelete, apiPost } from "@cartze/core/api/client";
import { toast } from "@cartze/core/ui/toast";

/**
 * THE BELL.
 *
 * A shop with the phone on the counter has to hear a new order without
 * watching for it. The Orders tab polls every fifteen seconds as well, and
 * that is deliberate: a push that is missed — permission refused, battery
 * saver, a phone that slept through it — must not be the difference between a
 * late order and a lost one. Push makes it fast; the poll makes it certain.
 *
 * ── What the server sends ────────────────────────────────────────────
 *
 * `order.placed`, to whoever holds `orders.manage` at the branch that has to
 * fill it, carrying `{ order_id }`. The title already reads "New online
 * order" — this app does not rewrite it, because the server knows things the
 * app does not (a phone order and a web checkout are different sentences).
 */

/** What a tap should open, handed to whoever is holding the navigator. */
export type PushTap = (orderId: string) => void;

let onTap: PushTap | null = null;

/** Set once, by the navigator. Before this, a tap simply opens the app. */
export function setPushTapHandler(handler: PushTap | null): void {
  onTap = handler;
}

/**
 * Ask, then register.
 *
 * ── Why the Android permission is asked EXPLICITLY ───────────────────
 *
 * On Android 13 and later a notification is silently dropped until the person
 * has been asked, and `requestPermission()` from the SDK does not raise the
 * OS dialog on Android — it is an iOS call that returns "authorised" on
 * Android whether or not the runtime permission exists. Trusting it is how a
 * shop ends up waiting for a bell that can never ring, with the app convinced
 * everything is fine.
 */
export async function askForNotifications(): Promise<boolean> {
  if (Platform.OS === "android") {
    // Below 33 the permission does not exist and is granted by installing.
    if (typeof Platform.Version === "number" && Platform.Version < 33) return true;

    const result = await PermissionsAndroid.request(
      "android.permission.POST_NOTIFICATIONS" as Parameters<typeof PermissionsAndroid.request>[0],
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  const status = await requestPermission(getMessaging());
  return (
    status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL
  );
}

/**
 * Tell the server which phone this is.
 *
 * Idempotent on both sides: the server upserts on the token, so re-registering
 * the same device is a no-op rather than a duplicate that gets pushed twice.
 */
async function register(token: string): Promise<void> {
  await apiPost("/devices", { token, platform: Platform.OS === "ios" ? "ios" : "android" });
}

/**
 * Start listening. Returns the teardown.
 *
 * Called AFTER sign-in, never before: the register call needs a session, and a
 * token registered against nobody is a push nobody receives.
 */
export async function startPush(): Promise<() => void> {
  const allowed = await askForNotifications();
  if (!allowed) {
    // Said once, plainly. A shop that refused the prompt should know what it
    // costs rather than discover it during a lunch rush.
    toast.info("Notifications are off — you will not hear new orders");
    return () => {};
  }

  const messaging = getMessaging();

  try {
    await register(await getToken(messaging));
  } catch {
    // A token that cannot be registered now is retried on the next refresh
    // and on the next sign-in. Failing loudly here would put an error over a
    // dashboard for something the poll already covers.
  }

  const stopRefresh = onTokenRefresh(messaging, (token) => {
    void register(token).catch(() => {});
  });

  /**
   * The app is OPEN and a push arrives.
   *
   * Android draws nothing itself in this case, so without this the order
   * lands silently in a list somebody may not be looking at. A toast, not a
   * system notification: the person is already in the app.
   */
  const stopForeground = onMessage(messaging, (message) => {
    const title = message.notification?.title ?? "New order";
    toast.info(message.notification?.body ? `${title} — ${message.notification.body}` : title);
  });

  /** Tapped while the app was in the background. */
  const stopOpened = onNotificationOpenedApp(messaging, (message) => {
    const id = message.data?.order_id;
    if (typeof id === "string" && onTap) onTap(id);
  });

  /**
   * TAPPED WHILE THE APP WAS NOT RUNNING AT ALL.
   *
   * A separate call, and the one people forget. `onNotificationOpenedApp`
   * fires only when the process already existed; a phone that was asleep with
   * the app killed — which is most of a night shift — delivers the tap here
   * instead, once, at startup. Without it the commonest tap of all opens the
   * dashboard and the order is never found.
   */
  const initial = await getInitialNotification(messaging);
  const initialId = initial?.data?.order_id;
  if (typeof initialId === "string" && onTap) onTap(initialId);

  return () => {
    stopRefresh();
    stopForeground();
    stopOpened();
  };
}

/**
 * Stop telling this phone about a shop it has signed out of.
 *
 * Without it, a shared shop phone keeps ringing for the last person's orders —
 * and the notification names a customer, which makes it a leak rather than an
 * annoyance.
 */
export async function stopPush(): Promise<void> {
  try {
    const token = await getToken(getMessaging());
    await apiDelete("/devices", { data: { token } });
  } catch {
    // Signing out must never fail because the network did.
  }
}
