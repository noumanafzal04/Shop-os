import { canVisit } from "../../common/routing/screenPermissions";

/**
 * WHERE A NOTIFICATION WANTS TO TAKE YOU.
 *
 * The backend has always sent one. `NotificationService` stamps every
 * notification with `data.link` — a logical route like `orders/8f2` or
 * `disposals` — deliberately client-agnostic so the phone and the panel can
 * each send it somewhere of their own. The mobile app reads it
 * (`shopos-mobile/src/services/push.ts`).
 *
 * The panel read the title, the body and the time, and dropped the link. So
 * "Low stock — Panadol is down to 3" was a sentence and nothing else: an owner
 * pressed it, it went grey, and finding the product was still their problem.
 * The whole point of a deep link is that the person who has just been told
 * about something does not then have to go looking for it.
 *
 * ── Somewhere real, or nowhere ──────────────────────────────────────────
 *
 * Two ways a link can be worse than no link, and both are live here:
 *
 *   1. **A screen that does not exist.** `announcements/{id}` is a genuine
 *      backend link, and there is no tenant-side announcements screen — only
 *      `/admin/announcements`, for platform staff. Following it would land a
 *      shopkeeper on a not-found.
 *   2. **A screen they may not open.** A cashier gets sent nothing today, but
 *      the moment they do, "low stock" points at `/tenant/inventory`, which is
 *      behind `inventory.manage`. Pressing it would bounce them off a guard —
 *      being told to go somewhere and then refused entry.
 *
 * So this returns a path only when there is a mapped screen AND this person can
 * open it. Everything else returns null, and the caller offers no navigation at
 * all: the notification stays readable and simply is not a link. Same rule as
 * the field-naming fallback in common/a11y — a wrong destination is worse than
 * no destination.
 *
 * ── Lists, not detail screens ───────────────────────────────────────────
 *
 * `orders/8f2` resolves to `/tenant/orders`, not to a per-order screen, because
 * the panel has no `:id` route for one — this side of the app works in lists.
 * That is honest rather than ideal: it puts the reader on the right screen with
 * the row on it. Worth revisiting when detail routes exist.
 */

/** Logical prefix (what the backend emits) → the screen that answers it. */
const SCREEN: Array<[RegExp, string]> = [
  [/^orders(\/|$)/, "/tenant/orders"],
  [/^reservations(\/|$)/, "/tenant/reservations"],
  [/^reviews(\/|$)/, "/tenant/reviews"],
  [/^inventory(\/|$)/, "/tenant/inventory"],
  [/^disposals(\/|$)/, "/tenant/disposals"],
  [/^subscription(\/|$)/, "/tenant/subscription"],
  // `announcements/{id}` is deliberately absent: no tenant screen shows one.
];

/**
 * The panel path for a notification's link, or null if there is nowhere to go.
 *
 * @param link the backend's logical route, from `notification.data.link`
 * @param can  this person's permission check, as the sidebar builds it
 */
export function screenForLink(
  link: unknown,
  can: (permission: string) => boolean,
): string | null {
  if (typeof link !== "string" || link === "") return null;

  const match = SCREEN.find(([pattern]) => pattern.test(link));
  if (match === undefined) return null;

  const path = match[1];

  return canVisit(path, can) ? path : null;
}
