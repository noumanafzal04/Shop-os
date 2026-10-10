import { formatRange, matchPreset, rangeName, type DateRange } from "../../components/ui/filters";

/**
 * THE LEDGER FOLLOWS THE PERIOD — until it is given dates of its own.
 *
 * The billing screen has one period at its head now, and the ledger at its
 * foot is the list of what that period's figure is made of: pick "Last
 * month" and both are last month's. But a ledger is also an archive — "what
 * did this shop ever pay", "whose is this reference" — and an archive that
 * can only be read a period at a time hides the row being looked for. So the
 * ledger can be given dates of its own, or none, and says which it is doing.
 *
 * `own === null` is "following". A range with both ends null is "any date",
 * chosen — which is not the same thing, and is why this is not a boolean.
 */
export const ANY_DATE: DateRange = { from: null, to: null };

export function ledgerDates(period: DateRange, own: DateRange | null): DateRange {
  return own ?? period;
}

const dated = (range: DateRange): boolean => range.from !== null || range.to !== null;

/** "This month", "Last month" — or the dates themselves when nobody has a name for them. */
export function datesName(range: DateRange, today: Date): string {
  const preset = matchPreset(range, today);

  return preset !== null && preset !== "all" ? rangeName(preset) : formatRange(range, today);
}

/** The line under the ledger's heading: whose dates it is showing. */
export function ledgerNote(period: DateRange, own: DateRange | null, today: Date): string {
  if (own === null) return `Following the period above — ${datesName(period, today)}. Clear the date to search every payment.`;
  if (!dated(own)) return "Every payment recorded, whatever the period above.";

  return `Its own dates — ${datesName(own, today)} — not the period above.`;
}

/** What the ledger's total is the total OF, beside the figure. */
export function ledgerTotalNote(dates: DateRange, narrowed: boolean, today: Date): string {
  // A search or a method is a filter nobody has a short name for.
  if (narrowed) return "in this filter";

  return dated(dates) ? datesName(dates, today) : "all time";
}

/**
 * An empty ledger, and whether the answer might simply be on another date.
 *
 * "No payment matches" under a period is the trap this exists for: somebody
 * searching for a shop reads it as "this shop never paid".
 */
export function ledgerEmpty(dates: DateRange, narrowed: boolean, today: Date): { says: string; offerEveryDate: boolean } {
  if (dated(dates)) {
    const name = datesName(dates, today);

    return {
      says: narrowed ? `No payment in ${name} matches — it may be on another date.` : `No payments in ${name}.`,
      offerEveryDate: true,
    };
  }

  return {
    says: narrowed ? "No payment matches these filters." : "No payments recorded yet.",
    offerEveryDate: false,
  };
}
