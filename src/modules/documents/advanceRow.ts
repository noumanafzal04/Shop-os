import { isPastDate } from "../../common/shopDay";
import { daysSince } from "../../common/format/since";
import type { SaleDocument } from "./services/documentService";

/** Nobody has paid into it for this long — the server's `SaleDocument::QUIET_DAYS`. */
export const QUIET_DAYS = 30;

export type AdvanceState = "paid_up" | "overdue" | "open" | "collected" | "cancelled";

/**
 * ONE ADVANCE, AS THE COUNTER NEEDS TO READ IT (L17).
 *
 * Paid in full and waiting to be handed over; past its collect-by date; or
 * still being paid for — and whether anybody has paid into it lately. The list
 * showed every open advance alike.
 */
export function advanceRow(
  doc: Pick<SaleDocument, "total" | "deposit_paid" | "status" | "expires_at" | "last_paid_at">,
  now: Date = new Date(),
): { paid: number; left: number; share: number; state: AdvanceState; quiet: boolean } {
  const total = Number(doc.total);
  const paid = Number(doc.deposit_paid);
  const left = Math.max(0, Math.round((total - paid) * 100) / 100);
  const share = total > 0 ? Math.min(1, paid / total) : 0;

  const state: AdvanceState =
    doc.status === "converted" ? "collected"
      : doc.status === "cancelled" ? "cancelled"
        : left <= 0 ? "paid_up"
          : isPastDate(doc.expires_at, now) ? "overdue"
            : "open";
  const quiet = (state === "open" || state === "overdue") && !!doc.last_paid_at && daysSince(doc.last_paid_at, now) > QUIET_DAYS;

  return { paid, left, share, state, quiet };
}
