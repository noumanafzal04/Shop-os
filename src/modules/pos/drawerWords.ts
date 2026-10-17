/**
 * A drawer's movements in the words a cashier uses.
 *
 * The system types (khata, supplier, expense, void, advance, rider) are
 * written by the flow that moved the money, never posted from the till — the
 * drawer still names them, because they still moved its cash.
 */
export const MOVEMENT_LABEL: Record<string, string> = {
  paid_in: "Paid in",
  paid_out: "Paid out",
  drop: "Safe drop",
  float_add: "Float added",
  no_sale: "No sale",
  khata_in: "Khata received",
  supplier_out: "Supplier paid",
  expense_out: "Expense paid",
  void_refund: "Void refund",
  deposit_in: "Advance taken",
  deposit_out: "Advance returned",
  rider_in: "Rider handed in",
};

/** Fallback for a type the server knows and this build doesn't. */
export const humanize = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const movementName = (type: string): string => MOVEMENT_LABEL[type] ?? humanize(type);

/**
 * THE LINE IN "HOW IT ADDS UP", named by what this shift actually had (B20).
 *
 * It said "Cash in (paid in, float)" whatever the cash was — so a khata
 * customer's 2,000 read as a float somebody added. Now it names the kinds of
 * movement behind the figure — in one fixed order, so the line reads the same
 * whichever way the list arrives.
 */
export function chainLabel(movements: ReadonlyArray<{ type: string; direction: string }>, way: "in" | "out"): string {
  const order = Object.keys(MOVEMENT_LABEL);
  const rank = (type: string) => (order.includes(type) ? order.indexOf(type) : order.length);
  const types = [...new Set(movements.filter((m) => m.direction === way).map((m) => m.type))].sort((a, b) => rank(a) - rank(b));
  const kinds = types.map(movementName);
  const head = way === "in" ? "Cash in" : "Cash out";

  return kinds.length === 0 ? head : `${head} (${kinds.join(", ")})`;
}
