import { useShopSettings } from "../../shop/hooks/useShop";
import { whyCannotRing } from "../services/posService";
import { useCurrentSession } from "./usePos";

/**
 * MAY THIS PERSON TAKE MONEY AT THE COUNTER, ON THIS SCREEN, RIGHT NOW?
 *
 * The till's own rule, for the other screens that ring a counter sale: New
 * Sale, a settled tab, an exchange, a quotation billed. A shop that asks for
 * shifts refuses them all without today's shift (the server does too —
 * SHIFT_REQUIRED / SHIFT_FROM_AN_EARLIER_DAY); the screen says so before the
 * press. Unknown while the session is still loading — never a refusal on a
 * guess.
 */
export function useCounterShift(): { ready: boolean; why: string | null } {
  const settings = useShopSettings();
  const session = useCurrentSession();
  const required = settings.data?.pos_require_shift === true;

  if (!required || session.data === undefined) return { ready: true, why: null };

  const why = whyCannotRing(session.data ?? null, true);

  return { ready: why === null, why };
}
