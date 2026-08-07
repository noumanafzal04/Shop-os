import { createNavigationContainerRef } from "@react-navigation/native";

/**
 * Deep-link plumbing. Every backend notification carries `data.link` — a
 * logical route like "orders/{id}" or "announcements/{id}" (see backend
 * App\Support\DeepLinks). This maps those strings (and shopos:// URLs)
 * to customer screens. Safe no-op when navigation isn't ready yet.
 */
// Loosely typed on purpose: deep links target routes across nested navigators.
export const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

let pending: string | null = null;

export function resolveDeepLink(link: string | undefined | null): void {
  if (!link) return;
  if (!navigationRef.isReady()) {
    pending = link; // app still booting — replay after mount
    return;
  }

  const path = link.replace(/^shopos:\/\//, "").replace(/^\/+/, "");
  const [head, id] = path.split("/");

  switch (head) {
    case "orders":
      if (id) navigationRef.navigate("Order", { id });
      else navigationRef.navigate("Tabs", { screen: "OrdersTab" });
      return;
    case "reservations":
      navigationRef.navigate("Reservations", undefined);
      return;
    case "announcements":
      navigationRef.navigate("Notifications", undefined);
      return;
    case "shop":
      if (id) navigationRef.navigate("MarketShop", { slug: id });
      return;
    default:
      return; // unknown routes are ignored, never crash
  }
}

/** Called once the NavigationContainer mounts — replays a link that arrived early. */
export function flushPendingDeepLink(): void {
  if (pending) {
    const link = pending;
    pending = null;
    resolveDeepLink(link);
  }
}
