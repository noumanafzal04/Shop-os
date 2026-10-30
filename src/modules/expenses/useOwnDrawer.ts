import { useAuthStore } from "../../stores/authStore";
import { useCurrentSession } from "../pos/hooks/usePos";
import { isCover } from "../pos/services/posService";
import type { OwnDrawer } from "./booksWords";

/**
 * Has THIS person a drawer of their own open right now?
 *
 * Cash filed as an expense or an income moves the filer's own open drawer and
 * nobody else's — the server's `record()` finds it by who is filing. Somebody
 * who cannot ring a sale is never asked, nor a shop that has no till at all;
 * while the answer is on its way it is unknown, never a "no" on a guess.
 */
export function useOwnDrawer(): OwnDrawer {
  const shopHasTill = useAuthStore((s) => s.user?.tenant?.features?.pos ?? false);
  const mayRing = useAuthStore((s) => s.user?.role === "shop_owner" || (s.user?.permissions?.includes("sales.manage") ?? false));
  const canTill = shopHasTill && mayRing;
  const session = useCurrentSession(canTill);

  if (!canTill) return "none";
  if (session.data === undefined) return null;

  return session.data !== null && !isCover(session.data) ? "open" : "none";
}
