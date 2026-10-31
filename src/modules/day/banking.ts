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

/**
 * WHAT "STILL IN THE SHOP" IS TAKEN FROM (#AZ7).
 *
 * It is the cash the drawers hold — COUNTED where a shift is closed, expected
 * where one is still trading — less what was banked. "In the drawers" beside
 * it is what they should hold. The caption said "In the drawers, less what was
 * banked", true only while every count matched: a shift counted 5,000 over
 * read In the drawers 1,140 · Banked 500 · Still in the shop 5,640.
 */
export function stillInTheShopHint(variance: number, word: (amount: number) => string): string {
  if (Math.abs(variance) < 0.005) return "In the drawers, less what was banked";

  return `What the drawers were counted at, less what was banked — the count was ${word(Math.abs(variance))} ${variance > 0 ? "over" : "short"}`;
}
