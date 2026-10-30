import { useAuthStore } from "../../../stores/authStore";
import { useOwnDrawer } from "../../expenses/useOwnDrawer";
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

/**
 * CASH THAT WILL REACH NO DRAWER, SAID BEFORE IT IS TAKEN (#SV1).
 *
 * A shop that does not ask for shifts takes a job's advance and its balance
 * with nobody's drawer open — a tailor never touches the till — and the day
 * then read CASH TAKINGS Rs 0 with Rs 5,630 of the customer's cash in the shop.
 * Not refused: the shop chose not to ask for shifts. Told, with the way to
 * have it counted. Null when it will reach a drawer, when it is not cash, when
 * the shop has no till, where a shift is required (useCashNeedsShift refuses
 * there), or while the answer is still on its way.
 */
export function useCashReachesNoDrawer(method: string, amount: number): string | null {
  const settings = useShopSettings();
  const drawer = useOwnDrawer();
  const shopHasTill = useAuthStore((s) => s.user?.tenant?.features?.pos ?? false);
  const required = settings.data?.pos_require_shift === true;

  if (!shopHasTill || required || method !== "cash" || !(amount > 0) || drawer !== "none") return null;

  return "No shift of yours is open, so this cash goes into no drawer and the day will not count it. Open a shift first to have it counted — card, bank or wallet money needs no drawer.";
}
