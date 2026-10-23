import type { BankDeposit, DayView } from "./services/dayService";

/**
 * HOW MUCH OF A DEPOSIT IS MORE THAN THE DRAWERS HOLD (next rounds #19).
 *
 * Rs 16,000 banked against Rs 15,403.17 in the tills was taken without a word
 * and "Still in the shop" read −596.83. Banking more is sometimes right —
 * yesterday's takings from the safe — so the sheet asks rather than refuses,
 * and needs this figure to ask with. 0 when the deposit fits, or when there is
 * no trading day to measure it against.
 *
 * Correcting a deposit already on today's day frees its old amount first: 1,600
 * typed over 16,000 is not 1,600 more.
 */
export function bankedBeyondDrawers(
  amount: number,
  view: Pick<DayView, "unbanked" | "deposits"> | null | undefined,
  correcting: Pick<BankDeposit, "id" | "amount"> | null = null,
): number {
  if (!view || !(amount > 0)) return 0;
  const freed = correcting && (view.deposits ?? []).some((d) => d.id === correcting.id) ? Number(correcting.amount) : 0;
  const room = Number(view.unbanked) + freed;

  return amount > room ? Math.round((amount - room) * 100) / 100 : 0;
}

/** A deposit may be corrected while its day trades; a closed day froze its banking. */
export function depositCanBeCorrected(deposit: Pick<BankDeposit, "business_day">, dayStatus?: string | null): boolean {
  return (dayStatus ?? deposit.business_day?.status ?? null) !== "closed";
}
