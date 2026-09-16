/**
 * STUB — structure only. BLOCKED: see docs/DECISIONS.md #1.
 *
 * Registering this device so the server can wake it when an order lands.
 *
 * ── The server half already exists ───────────────────────────────────
 *
 *   DeviceToken model, POST /devices, FcmSender, SendChannelNotification,
 *   and `order.placed` already fires into all of it.
 *
 * ── The app half exists nowhere ──────────────────────────────────────
 *
 *   @react-native-firebase/app + /messaging   not a dependency
 *   android/app/google-services.json          missing, in BOTH apps
 *
 * Until that file exists this is a no-op, and the app is pull-to-refresh
 * only. Which is worth stating plainly: a partner app a shop has to poll
 * is a partner app a shop stops opening.
 */
