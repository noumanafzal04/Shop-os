import { useAuthStore } from "../../stores/authStore";
import type { User } from "../auth/types";

/**
 * Whose table is this, and may I work it?
 *
 * Mirrors `RestaurantTicketController::assertMayWork` — the backend is the
 * authority and re-checks every write; this exists so a waiter sees a table
 * marked as somebody else's instead of discovering it by being refused.
 *
 * The three edges are the server's, kept identical on purpose:
 *   - a tab with NO waiter belongs to everyone (a counter takeaway);
 *   - your own table is always yours;
 *   - `tables.serve_any` lifts it — the till, a supervisor, a manager.
 *
 * Reading is never gated. This answers "may I change it", not "may I see it".
 */
export function mayWorkTable(user: User | null, waiterId: string | null | undefined): boolean {
  if (!waiterId) return true;
  if (!user) return false;
  if (user.id === waiterId) return true;

  return user.role === "shop_owner" || user.permissions.includes("tables.serve_any");
}

export function useMayWorkTable(): (waiterId: string | null | undefined) => boolean {
  const user = useAuthStore((s) => s.user);

  return (waiterId) => mayWorkTable(user, waiterId);
}
