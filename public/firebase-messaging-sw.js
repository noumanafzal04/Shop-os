/*
 * THE SERVICE WORKER THAT RECEIVES A PUSH WHEN THE PANEL IS CLOSED.
 *
 * ── Why this file exists at all ──────────────────────────────────────
 *
 * A shop owner with the panel open learns about a new order from the
 * thirty-second poll. A shop owner with the phone in their pocket learns
 * nothing, and that is most of a working day. This is the only way a browser
 * can wake up for a message when nothing of ours is running.
 *
 * ── Why it is a plain file in `public/`, not part of the build ───────
 *
 * Firebase Messaging demands a worker at exactly `/firebase-messaging-sw.js`
 * on the origin. It also runs SEPARATELY from the Workbox worker VitePWA
 * generates — two workers, two jobs, no conflict — which is why this is not
 * folded into that one.
 *
 * ── Why the config arrives in the URL ────────────────────────────────
 *
 * A worker cannot read `import.meta.env`, and baking the project's config into
 * a static file means editing a committed file to change environments. So the
 * page registers it as `/firebase-messaging-sw.js?apiKey=…&projectId=…` and it
 * reads its own query string. None of those values is a secret — a Firebase
 * web config is public by design; the SERVICE ACCOUNT on the server is the
 * part that is not.
 */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

const params = new URL(self.location.href).searchParams;

const config = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
};

// No project, no worker. Registering without one throws on every push and
// fills the console of an install that was never meant to have notifications.
if (config.projectId) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  /*
   * A message that arrives with a `notification` block is drawn by the browser
   * itself, and drawing it again here shows it twice. This handler is for the
   * DATA-only case and for adding what the browser cannot know: where the tap
   * should go.
   */
  messaging.onBackgroundMessage((payload) => {
    const n = payload.notification ?? {};
    const data = payload.data ?? {};

    if (n.title) return; // already shown by the browser

    self.registration.showNotification(data.title || "CartZe", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Collapse repeats of the same subject rather than stacking six
      // notifications about one order.
      tag: data.type ? `${data.type}:${data.order_id ?? ""}` : undefined,
      renotify: true,
      data: { link: data.link ?? null },
    });
  });
}

/*
 * A tap goes to the screen the notification is about — and to a TAB THAT IS
 * ALREADY OPEN wherever possible. Opening a second copy of the panel loses
 * whatever the first one had on screen, and a shop with the orders list open
 * would end up with two.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const link = event.notification.data && event.notification.data.link;

  /*
   * A QUERY PARAMETER, not a path. The app already owns the rule for turning
   * `orders/8f2` into a screen — `routeForNotification` — and that rule also
   * refuses to send somebody to a screen their permissions do not open. A
   * worker that invented its own path would be a second copy of that rule with
   * no way to ask about permissions at all.
   */
  const target = link ? `/?n=${encodeURIComponent(link)}` : "/tenant/orders";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.postMessage({ kind: "cartze:notification-click", link });
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
