import { useAuthStore } from "../../stores/authStore";

/**
 * The business type to make decisions with.
 *
 * A tenant created before the eight current types — or imported from an older
 * system — still carries a narrow code: `clinic`, `workshop`, `salon`,
 * `grocery`, `restaurant`. Those shops keep trading, because modules resolve
 * for them either way. What silently stopped working was every rule written as
 * "is this shop a pharmacy?", because each one compared against the CURRENT
 * codes: an old clinic got no dispensing register and no prescription capture
 * at the till, an old workshop no vehicle register.
 *
 * The server resolves the code once (BusinessTypes::primary) and sends it as
 * `business_type_primary`. Every gate on the shop side reads THIS. The raw
 * `business_type` stays for display and for the admin who chose it.
 *
 * The fallback matters: a session persisted before the field existed still has
 * only the raw code, and a shop must not lose screens waiting for a refresh.
 */
export function usePrimaryBusinessType(): string | null {
  return useAuthStore((s) => {
    const tenant = s.user?.tenant as
      | { business_type?: string | null; business_type_primary?: string | null }
      | null
      | undefined;

    return tenant?.business_type_primary ?? tenant?.business_type ?? null;
  });
}

/**
 * The trades that sell a unit somebody can bring back under warranty.
 *
 * Serial capture is driven end to end by the product's own `tracks_serial`
 * flag — the till renders the IMEI prompt from it and the server carries no
 * type gate at all. Two panel conditions decided who could ever SET that flag
 * and who could reach the warranty desk, and both said `retail` alone. So the
 * auto aftermarket, whose batteries are the most-claimed warranty item on a
 * Pakistani forecourt, could neither record a serial nor answer "is this still
 * covered?" — against a capability that was fully built.
 *
 * One list, read by the product form and the sidebar, so the place you turn it
 * on and the place you look it up can never disagree again.
 */
export const SERIAL_TRADES = ["retail", "automotive", "petroleum"];

/** Does this trade sell serial-tracked, warrantied units? */
export function tracksSerials(businessType: string | null | undefined): boolean {
  return SERIAL_TRADES.includes(businessType ?? "");
}
