import {
  BellIcon,
  CalendarIcon,
  CheckCircleIcon,
  MotorcycleIcon,
  ParcelIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  WarningIcon,
  XCircleIcon,
  type Icon,
} from "../../common/ui/icons";

/**
 * WHAT A NOTIFICATION IS ABOUT, AND WHERE IT GOES.
 *
 * ── The screen this exists for ───────────────────────────────────────
 *
 * The notifications list drew every row identically — a bold line, a grey
 * line, nothing else — and none of them went anywhere. "Rider on the way" and
 * "Order cancelled" looked the same, read the same at a glance, and both did
 * nothing when pressed.
 *
 * That is the wrong shape twice over. A notification is a POINTER: its whole
 * job is to get somebody to the thing it is about, and a list of pointers that
 * point nowhere is a list of receipts. And the one thing that distinguishes
 * them — is this good news, bad news, or something to act on — was carried
 * only by words somebody had to read.
 *
 * ── The server already sent everything needed ────────────────────────
 *
 * `type` and `data` have been on the payload since notifications existed;
 * `AppNotification` casts `data` to an array and the endpoint returns the
 * model whole. The app was throwing both away and rendering the title.
 */

export type NotificationTone = "info" | "good" | "bad" | "act";

export interface NotificationKind {
  icon: Icon;
  tone: NotificationTone;
  /**
   * Where a press should land, given the notification's own `data`.
   *
   * Returns null when there is nowhere honest to go — and a row that knows it
   * leads nowhere renders without a chevron rather than as a button that does
   * nothing, which is the failure this replaces.
   */
  target?: (data: Record<string, unknown>) => { route: string; params?: object } | null;
}

/** An order's own screen, when the notification names one. */
const toOrder = (data: Record<string, unknown>) =>
  typeof data.order_id === "string" ? { route: "Order", params: { id: data.order_id } } : null;

/** A rider's copy of the same order — a different screen, same id. */
const toJob = (data: Record<string, unknown>) =>
  typeof data.order_id === "string" ? { route: "RiderJob", params: { id: data.order_id } } : null;

const KINDS: Record<string, NotificationKind> = {
  // ── The customer's own order, through its stages ──────────────────
  "order.placed": { icon: ReceiptIcon, tone: "info", target: toOrder },
  "order.rider_assigned": { icon: MotorcycleIcon, tone: "info", target: toOrder },
  "order.out_for_delivery": { icon: MotorcycleIcon, tone: "act", target: toOrder },
  "order.completed": { icon: CheckCircleIcon, tone: "good", target: toOrder },
  "order.cancelled": { icon: XCircleIcon, tone: "bad", target: toOrder },

  // ── The shop's side ───────────────────────────────────────────────
  //
  // `no_rider` is the one that costs money if it is missed, which is why it
  // is the loudest thing this file can make a row.
  "order.no_rider": { icon: WarningIcon, tone: "bad", target: toOrder },
  "order.rider_declined": { icon: WarningIcon, tone: "bad", target: toOrder },
  "stock.low": { icon: ParcelIcon, tone: "act" },

  // ── The rider's ───────────────────────────────────────────────────
  "rider.job_offered": { icon: ParcelIcon, tone: "act", target: toJob },
  "rider.approved": { icon: ShieldCheckIcon, tone: "good" },

  // ── Reservations ──────────────────────────────────────────────────
  "reservation.created": { icon: CalendarIcon, tone: "info" },
  "reservation.accepted": { icon: CalendarIcon, tone: "good" },
  "reservation.rejected": { icon: XCircleIcon, tone: "bad" },
};

/**
 * Never null.
 *
 * A type this app has not heard of is a server that has moved on, and the
 * honest thing is to show the notification with a plain bell rather than to
 * drop it — a message somebody was sent and never saw is worse than one shown
 * without a mark.
 */
export function notificationKind(type: string | null | undefined): NotificationKind {
  return (type != null && KINDS[type]) || { icon: BellIcon, tone: "info" };
}

/**
 * How long ago, in the words people use.
 *
 * Not a date. A notification list is read top-down and the question is "is
 * this the one from just now" — "6 Sep" answers a different question, and
 * answers it three times in a row for everything sent this afternoon.
 */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const secs = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (secs < 60) return "Just now";

  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  // Past a month it stops being "ago" and becomes a date — but a date this
  // list will almost never reach, because notifications get read.
  if (weeks < 5) return `${weeks}w`;

  return then.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: then.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
