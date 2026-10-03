import { apiGet, apiPost } from "@cartze/core/api/client";
import type { ApiEnvelope } from "@cartze/core/types/api";

/**
 * THE IN-APP FEED.
 *
 * ── Why this ships whatever push does ────────────────────────────────
 *
 * A push notification is a tap on the shoulder and nothing more: it is
 * dismissed, it arrives on one device, and it is gone. This is the RECORD —
 * the only way a shop learns what happened while the app was shut, and the
 * only place to look twice.
 *
 * Fields read out of `create_app_notifications_table.php` and
 * `NotificationController`, not guessed.
 */

export interface AppNotification {
  id: string;
  /** `order.placed` | `stock.low` | `review.created` | … — the server's own. */
  type: string;
  title: string;
  body: string;
  /** Whatever the sender attached. Shapes differ per `type`; nothing here
   *  reads into it, because a screen that guesses at it crashes on the first
   *  type it has not met. */
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export const notificationService = {
  list: (page = 1): Promise<ApiEnvelope<AppNotification[]>> =>
    apiGet<AppNotification[]>("/notifications", { params: { page } }),

  markRead: (id: string): Promise<ApiEnvelope<AppNotification>> =>
    apiPost<AppNotification>(`/notifications/${id}/read`, {}),

  markAllRead: (): Promise<ApiEnvelope<null>> => apiPost<null>("/notifications/read-all", {}),
};
