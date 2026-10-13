/**
 * WHAT THE SHELL NEEDS ON EVERY SCREEN IS KEPT, NOT ASKED FOR.
 *
 * Opening any screen used to ask the server seven things before the screen
 * asked its own: who am I, the shop's settings, its branches, the bell, this
 * till announcing itself, the till's roster, and what changed in the
 * catalogue. None of them had changed since the last screen. Reloading five
 * screens cost thirty-five requests that brought back what the device already
 * had — and the API allows a person 240 a minute.
 *
 * The owner, of the first of them (the count beside "Orders"): "aise to theek
 * nahi, har baar load ho — jab hum store use kar rahe hain to aisi cheezain
 * kyun nahi use kar rahe, ke rate limit theek rahe, request time na ho". So
 * the last answer stays on the device, with the moment it was heard, and a
 * screen that opens inside the time an answer is trusted asks nothing.
 *
 * It is asked again when there is a reason to:
 *
 *   this device changed it    the screens that save already refresh the
 *                             answer (`invalidateQueries`), and the fresh one
 *                             is kept in its place
 *   somebody else changed it  an admin switches a module on, the owner
 *                             changes a cashier's permissions from the
 *                             office. Every answer the server gives carries a
 *                             short stamp of what the shell's answers are made
 *                             from (`shellStamp.ts`). When it differs from the
 *                             one a kept answer was heard under, that answer
 *                             is asked for again — on the very next request
 *                             the device makes, which a reload always is
 *   it has been a while       each answer says how long it is trusted
 *                             (`staleTime`). Past that, the screen opens from
 *                             the kept answer at once and asks behind it. This
 *                             is the backstop, for what no stamp can say: a
 *                             subscription that lapsed because the clock moved
 *
 * What is kept is somebody's. One record, and it belongs to one person in one
 * shop: the next person to sign in at the same counter starts an empty one,
 * and signing out throws it away.
 */

/** One kept answer, and when this device heard it. */
export interface Held {
  data: unknown;
  /** This device's clock, compared only with itself. */
  at: number;
  /**
   * The server's stamp at the moment this was heard. Absent when the server
   * sent none — an older server, or a browser not allowed to read the header
   * — and then the answer is judged by its age alone.
   */
  under?: string | null;
}

/** Everything kept on the device, and whose it is. */
export interface KeptRecord {
  owner: string;
  held: Record<string, Held>;
  /** The newest stamp the server has sent this person. See `shellStamp.ts`. */
  stamp?: string | null;
}

/**
 * Whose a kept answer is: `shop:person`, or `-:person` for somebody who is in
 * no shop (the platform's own staff, a customer). Null while nobody is signed in.
 */
export function ownerOf(shop: string | null | undefined, person: string | null | undefined): string | null {
  return person ? `${shop || "-"}:${person}` : null;
}

/** The kept answer by this name — nothing, if the record is somebody else's. */
export function heldFor(record: KeptRecord | null, owner: string | null, name: string): Held | null {
  if (record === null || owner === null || record.owner !== owner) return null;

  return record.held[name] ?? null;
}

/**
 * When a kept answer was heard, as a query should believe it.
 *
 * An answer "from the future" is a device whose clock was put back since.
 * How old it really is cannot be known, so it is treated as old: shown, and
 * asked about at once. Believing the stamp would hold it fresh for as long as
 * the difference — a day, if the date was wrong — and never ask.
 */
export function believedAt(at: number, now: number): number {
  return at > now ? 0 : at;
}

/**
 * Does an answer heard under one stamp still stand, now the stamp is another?
 *
 * Only two KNOWN stamps that differ say it does not. An answer kept before
 * stamps existed, or a server that sends none, is not evidence of a change —
 * calling that stale would ask for everything on every load, which is the
 * fault this whole folder exists to remove.
 */
export function stillStands(under: string | null | undefined, now: string | null | undefined): boolean {
  return !under || !now || under === now;
}

/**
 * Is it time to do again something last done at `at`?
 *
 * Never done is due. Done "in the future" is a clock that was put back, and
 * is due — the alternative is a till that stays silent until the clock
 * catches up with the mistake.
 */
export function isDue(at: number | null | undefined, now: number, every: number): boolean {
  if (at === null || at === undefined || !Number.isFinite(at)) return true;

  return at > now || now - at >= every;
}
