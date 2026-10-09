/**
 * A PASSWORD TO SAY ACROSS A COUNTER.
 *
 * When the platform makes a sign-in for somebody — keeping a demo shop for the
 * shopkeeper standing beside the admin — the password is going to be read out
 * loud and typed into a phone. So it is built for that, not for a password
 * manager:
 *
 *   four letters, four digits, four letters, with hyphens between — three
 *   things to say, each short enough to hold in the head;
 *   no i, l or o among the letters and no 0 or 1 among the digits, because
 *   "is that an el or a one" is how a first sign-in fails;
 *   lower case only, since "capital" doubles the length of saying it.
 *
 * Twenty-three letters to the eighth power times eight digits to the fourth is
 * about 3 × 10¹⁴ — far past guessing through a throttled sign-in, and the owner
 * is expected to change it.
 *
 * `crypto.getRandomValues`, not `Math.random` (which is not for secrets) and
 * not `crypto.randomUUID` (which does not exist on a page served over plain
 * http — see common/uuid).
 */
const LETTERS = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";

/** `count` whole numbers, each as random as the browser can make them. */
type Dice = (count: number) => ArrayLike<number>;

const browserDice: Dice = (count) => crypto.getRandomValues(new Uint32Array(count));

export function suggestPassword(dice: Dice = browserDice): string {
  const rolls = dice(12);
  const pick = (from: string, at: number): string => from[rolls[at] % from.length];
  const run = (from: string, start: number): string =>
    Array.from({ length: 4 }, (_, i) => pick(from, start + i)).join("");

  return `${run(LETTERS, 0)}-${run(DIGITS, 4)}-${run(LETTERS, 8)}`;
}
