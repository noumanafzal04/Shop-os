import { createNavigationContainerRef } from "@react-navigation/native";

/**
 * Deep-link plumbing. Every backend notification carries `data.link` — a
 * logical route like "orders/{id}" or "announcements/{id}" (see backend
 * App\Support\DeepLinks). This maps those strings to customer screens, and is
 * a safe no-op when navigation isn't ready yet.
 *
 * ANY scheme is stripped, not one particular spelling. Two reasons: the app's
 * scheme is a brand-shaped thing that will change with the name, and no scheme
 * is registered with either OS yet — so today a link arrives bare, from a push
 * payload, and the prefix handling exists for when one is.
 */
// Loosely typed on purpose: deep links target routes across nested navigators.
export const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

let pending: string | null = null;

/**
 * The route inside a link, whatever shape the link arrived in.
 *
 * A web link and an app link do not divide the same way, and treating them
 * alike is the bug this exists to avoid:
 *
 *   https://cartze.shop/shop/burger-hut   host is the SITE   → /shop/burger-hut
 *   cartze://shop/burger-hut              host is the ROUTE  → /shop/burger-hut
 *   shop/burger-hut                       already a path     → /shop/burger-hut
 *
 * Strip "everything up to the first slash" from all three and the middle one
 * loses the word `shop` — the link opens the app and lands nowhere, which
 * reads to whoever shared it as a broken link rather than a broken parser.
 */
function routeOf(link: string): string {
  const web = link.match(/^https?:\/\/[^/]+(\/.*)?$/i);
  const raw = web ? (web[1] ?? "") : link.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");

  // A shared link collects tracking params on its way through a chat app.
  return raw.split(/[?#]/)[0].replace(/^\/+/, "");
}

export function resolveDeepLink(link: string | undefined | null): void {
  if (!link) return;
  if (!navigationRef.isReady()) {
    pending = link; // app still booting — replay after mount
    return;
  }

  const [head, id, sub, subId] = routeOf(link).split("/").filter(Boolean);

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

    // A shared link to a shop, or to one item on its menu. The item's id rides
    // WITH the shop rather than alone, so the app can open the sheet without
    // first asking the server which counter the thing belongs to — and so a
    // link still lands somewhere useful if the item has since been delisted.
    case "shop":
      if (!id) return;
      navigationRef.navigate("MarketShop", {
        slug: id,
        productId: sub === "product" ? subId : undefined,
      });
      return;

    // Saved items. Both spellings on purpose: the screen is called Favorites
    // and people call it a wishlist, and a link that 404s because of which
    // word someone typed is a link that looks broken.
    case "wishlist":
    case "favorites":
      navigationRef.navigate("Favorites", undefined);
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
