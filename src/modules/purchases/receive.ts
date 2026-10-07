/**
 * WHAT IS WRITTEN DOWN WHEN GOODS ARRIVE.
 *
 * A box of phones is five boxes and five numbers. The receive sheet counted
 * the numbers typed, said "more serials than units received" in small red
 * print — and left the button lit, so six numbers were sent against five
 * boxes and the refusal came back from the server after the press. The same
 * number scanned twice was not said at all: it came back as "the
 * items.0.serials.1 field has a duplicate value".
 *
 * The sheet knows both before anything is sent. This is where it knows it.
 */

/** The numbers typed into the box: one per line (or comma), trimmed, blanks dropped. */
export const parseSerials = (typed: string): string[] =>
  typed.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

export interface NumbersCheck {
  /** How many numbers were written. */
  count: number;
  /** More numbers than boxes. */
  tooMany: boolean;
  /** The first number written more than once, if any. */
  repeated: string | null;
  /** Boxes that will go on the shelf with no number against them. */
  unnumbered: number;
  /** Can this line be sent as it stands? */
  ok: boolean;
}

/** The numbers written against one line, checked against how many boxes are being received. */
export function checkNumbers(typed: string, quantity: number): NumbersCheck {
  const serials = parseSerials(typed);
  const boxes = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
  const seen = new Set<string>();
  let repeated: string | null = null;
  for (const s of serials) {
    if (seen.has(s) && repeated === null) repeated = s;
    seen.add(s);
  }
  const tooMany = serials.length > boxes;

  return {
    count: serials.length,
    tooMany,
    repeated,
    unnumbered: tooMany ? 0 : boxes - serials.length,
    ok: !tooMany && repeated === null,
  };
}

interface Outstanding {
  quantity_ordered: number | string;
  quantity_received: number | string;
  product?: { tracks_serial?: boolean; item_type?: string } | null;
}

/**
 * Does anything still to arrive on this order need something WRITTEN about it?
 *
 * A medicine cannot go on the shelf without its expiry, and a phone is sold
 * by a number nobody has typed yet. "Receive all" is one press with no
 * questions — for these it either cannot work (the medicine is refused) or
 * works by skipping the very thing the item was carded for (the numbers).
 * An order with such a line is received on the sheet that asks.
 */
export function needsDetails(items: Outstanding[]): boolean {
  return items.some(
    (it) =>
      Number(it.quantity_ordered) - Number(it.quantity_received) > 0
      && (!!it.product?.tracks_serial || it.product?.item_type === "medicine"),
  );
}
