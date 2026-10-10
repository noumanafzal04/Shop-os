import type { KindOfBusiness } from "../../common/tenant/kindOfBusiness";
import type { LedgerType } from "./services/ledgerService";

/** Every kind of line the ledger can hold, in the order the chips are drawn. */
const TYPES: Array<{ value: LedgerType; label: string; when: (kind: LedgerKind) => boolean }> = [
  // A sale, and a sale given back: only a business that sells has either.
  { value: "sale", label: "Sales", when: (k) => k.sells },
  { value: "income", label: "Income", when: () => true },
  { value: "expense", label: "Expenses", when: () => true },
  { value: "refund", label: "Refunds", when: (k) => k.sells },
  // The fifth money source. Paying the wholesaler is not an expense — a shop
  // that files the wholesaler's bill AND records the payment would double-count
  // it — so it is its own row type, and needs its own filter. It needs a
  // supplier book to exist at all.
  { value: "supplier_payment", label: "Supplier paid", when: (k) => k.buysFromSuppliers },
];

type LedgerKind = Pick<KindOfBusiness, "sells" | "buysFromSuppliers">;

/**
 * WHICH KINDS OF LINE THIS BUSINESS'S LEDGER CAN HOLD.
 *
 * The chips above the ledger narrow it to a kind of line. All five were drawn
 * for everybody, so a books-only business was offered Sales, Refunds and
 * Supplier paid — three buttons that can only ever answer "Nothing matches
 * these filters", on the screen that is its whole product.
 */
export function ledgerTypes(kind: LedgerKind): Array<{ value: LedgerType; label: string }> {
  return TYPES.filter((t) => t.when(kind)).map(({ value, label }) => ({ value, label }));
}

/** What the ledger is, in this business's terms. */
export function ledgerSays(kind: Pick<KindOfBusiness, "sells">): string {
  const what = "Every movement of money, in the order it happened, with the balance carried down.";

  return kind.sells ? `${what} Sales and refunds are counted automatically — you never enter them here.` : what;
}
