/**
 * THE SETTLE SHEET — what it asks the server, and what it sends once told.
 *
 *     "Take Rs 4,485" — pressed — "Amount paid (4,485.00) is less than the
 *      total (4,611.90)."
 *
 * The sheet used to work the bill out here: the chosen lines, times the
 * shop's default tax rate. A table with tea at its own 18% owed more than
 * that, the sheet sent its own figure as the cash handed over, and the till
 * refused it. The tab could not be settled from the screen.
 *
 * It does no arithmetic about the bill any more. It says WHAT is being
 * settled and HOW it will be paid, the server answers with the figures the
 * sale will charge (`POST …/settle/worth`), and the only sums left here are
 * the ones that are the cashier's to make: how a known amount is divided
 * between two tenders.
 */

/** A line still to pay, as much of it as the sheet needs. */
export interface OpenLine {
  id: string;
  quantity: string | number;
}

/** What the sheet asks about. */
export interface SettleAsk {
  splits: Array<{ id: string; quantity: number }>;
  /** How it will be paid — a bill wholly in cash settles to the shop's coin. */
  methods: string[];
  tip_amount: number;
}

/** What the server answers. */
export interface SettleWorth {
  subtotal: number;
  discount: number;
  tax: number;
  /** The bill — what the invoice will say. */
  total: number;
  tip: number;
  /** The coin: nought, or what a cash bill moves by. */
  rounding: number;
  /** What has to cross the counter. */
  due: number;
}

const paisa = (n: number) => Math.round(n * 100) / 100;
const amount = (typed: string) => Math.max(0, paisa(Number(typed) || 0));

/** The lines chosen, each as much of it as was chosen. A line at nought is not being settled. */
export function splitsOf(lines: OpenLine[], chosen: Record<string, number>): SettleAsk["splits"] {
  return lines
    .map((line) => ({ id: line.id, quantity: Math.min(Number(line.quantity), chosen[line.id] ?? 0) }))
    .filter((split) => split.quantity > 0);
}

/** A second method only counts once money has been typed against it — until then the bill is one tender. */
export function methodsOf(method: string, secondMethod: string, secondTyped: string): string[] {
  return secondMethod !== "" && secondMethod !== method && amount(secondTyped) > 0 ? [method, secondMethod] : [method];
}

export function askOf(
  lines: OpenLine[],
  chosen: Record<string, number>,
  method: string,
  secondMethod: string,
  secondTyped: string,
  tipTyped: string,
): SettleAsk {
  return { splits: splitsOf(lines, chosen), methods: methodsOf(method, secondMethod, secondTyped), tip_amount: amount(tipTyped) };
}

/**
 * How a known amount is divided between the tenders.
 *
 * The second is what was typed, and never more than is owed; the first is the
 * rest. Returns one tender when there is no second.
 */
export function tendersOf(due: number, ask: SettleAsk, secondTyped: string): Array<{ method: string; amount: number }> {
  if (ask.methods.length < 2) return [{ method: ask.methods[0], amount: paisa(due) }];

  const second = Math.min(paisa(due), amount(secondTyped));

  return [
    { method: ask.methods[0], amount: paisa(due - second) },
    { method: ask.methods[1], amount: second },
  ];
}

/** What is sent to settle. */
export interface Settlement {
  splits: SettleAsk["splits"];
  payment_method?: string;
  amount_paid?: number;
  payments?: Array<{ method: string; amount: number }>;
  tip_amount?: number;
}

/** The settlement, in the shape the endpoint takes: one tender is one field, two are the array. */
export function settlementOf(worth: SettleWorth, ask: SettleAsk, secondTyped: string): Settlement {
  const tenders = tendersOf(worth.due, ask, secondTyped);

  return {
    splits: ask.splits,
    ...(tenders.length === 2 && tenders[1].amount > 0 && tenders[0].amount > 0
      ? { payments: tenders }
      : tenders.length === 2 && tenders[0].amount <= 0
        // All of it went on the second method: that is one tender, the second one.
        ? { payment_method: tenders[1].method, amount_paid: tenders[1].amount }
        : { payment_method: tenders[0].method, amount_paid: paisa(worth.due) }),
    tip_amount: ask.tip_amount || undefined,
  };
}
