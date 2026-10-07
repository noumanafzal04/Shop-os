/**
 * A UNIT IS SOLD BY ITS NUMBER.
 *
 * A phone, a laptop, a battery: the shop cards it "capture a serial / IMEI
 * for each unit sold", and the number is what a warranty is found by a year
 * later. The till drew a chip — "IMEI 0/1", in amber — and that was all it
 * did about it:
 *
 *   it took the money for a phone with NO number, without a word
 *
 *   it SENT numbers the cashier could no longer see: two written, the
 *   quantity put back to one, and the second went to the server from a slot
 *   the sheet had stopped drawing — "more serials than units sold", with
 *   nothing on screen to delete
 *
 *   it let the same number be written on two units
 *
 *   and scanning the number on the box — the one barcode a phone shop
 *   actually scans — found nothing
 *
 * These are the questions, asked in one place so the chip, the sheet, the
 * Tender key and what is sent can never give different answers.
 */

export interface NumberedLine {
  key: string;
  name: string;
  quantity: number;
  tracks_serial?: boolean;
  serials?: string[];
  /** The cashier said, in so many words, that this line goes out with units that have no number. */
  unnumbered_ok?: boolean;
}

/** How many units a line is — a number belongs to a whole unit. */
export const unitsOn = (l: Pick<NumberedLine, "quantity">): number => Math.max(1, Math.floor(l.quantity));

/**
 * The numbers written on a line, FOR THE UNITS IT HAS.
 *
 * A slot past the quantity is not a unit. This is what the chip counts and
 * what is sent — the same list, so the till cannot send a number it is not
 * showing.
 */
export const numbersOn = (l: Pick<NumberedLine, "quantity" | "serials">): string[] =>
  (l.serials ?? []).slice(0, unitsOn(l)).map((s) => (s ?? "").trim()).filter(Boolean);

/** Units of a numbered line that have no number yet. Zero for a line that is not sold by number. */
export const owed = (l: NumberedLine): number => (l.tracks_serial ? unitsOn(l) - numbersOn(l).length : 0);

/** The first line the till has to ask about before it takes any money. */
export function firstOwing<L extends NumberedLine>(cart: L[]): L | null {
  return cart.find((l) => owed(l) > 0 && !l.unnumbered_ok) ?? null;
}

/** A number written on two units anywhere on the bill — and the second line it is on. */
export function writtenTwice<L extends NumberedLine>(cart: L[]): { serial: string; line: L } | null {
  const seen = new Set<string>();
  for (const l of cart) {
    if (!l.tracks_serial) continue;
    for (const s of numbersOn(l)) {
      if (seen.has(s)) return { serial: s, line: l };
      seen.add(s);
    }
  }

  return null;
}

/**
 * Write a scanned number on a line.
 *
 * Into the first unit that has none; and when every unit already has one,
 * the line grows by a unit — a second phone of the same model was scanned.
 * A number already on the line changes nothing: the same box, scanned twice.
 */
export function withNumber<L extends NumberedLine>(l: L, serial: string): L {
  const number = serial.trim();
  if (number === "" || numbersOn(l).includes(number)) return l;

  const units = unitsOn(l);
  const slots = Array.from({ length: units }, (_, i) => (l.serials?.[i] ?? "").trim());
  const free = slots.findIndex((s) => s === "");
  if (free >= 0) {
    slots[free] = number;

    return { ...l, serials: slots };
  }

  return { ...l, quantity: units + 1, serials: [...slots, number] };
}

/**
 * Numbers written that are not among the units on the shelf.
 *
 * Only when the shop HAS units on the shelf by number: a shop that never
 * wrote numbers down at goods-in has nothing to check against, and every
 * number would be a stranger.
 */
export function strangers(written: string[], onShelf: string[]): string[] {
  if (onShelf.length === 0) return [];
  const known = new Set(onShelf);

  return written.map((s) => s.trim()).filter((s) => s !== "" && !known.has(s));
}
