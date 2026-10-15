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
export function useCounterShift(doing?: string): { ready: boolean; why: string | null } {
  const settings = useShopSettings();
  const session = useCurrentSession();
  const required = settings.data?.pos_require_shift === true;

  if (!required || session.data === undefined) return { ready: true, why: null };

  const why = whyCannotRing(session.data ?? null, true, doing);

  return { ready: why === null, why };
}

/**
 * CASH TAKEN AS AN ADVANCE GOES INTO A DRAWER TOO.
 *
 * A layaway's or a job's cash advance, taken by someone with no shift, was
 * recorded and reached no drawer, without a word (L2). A shop that asks for
 * shifts now refuses it as it refuses a sale; card, bank and wallet money
 * needs no drawer and is never held up. Null when the money may be taken.
 */
export function useCashNeedsShift(method: string, amount: number): string | null {
  const { why } = useCounterShift("to take cash");

  return method === "cash" && amount > 0 && why !== null ? `${why} Card, bank or wallet money needs no drawer.` : null;
}
