import { ReactNode } from "react";

/**
 * The cell a list draws when it has nothing to draw.
 *
 * ── Why it is a component and not a `<td className="text-center">` ───────
 *
 * Because that is what it was, in two dozen places, and on a phone the
 * sentence was off the side of the screen. Measured at 390px:
 *
 *   /tenant/purchases  "No purchase orders yet."   ran to 474px
 *   /tenant/customers  "No customers yet — …"      ran to 485px
 *   /tenant/coupons    "No coupons yet."           ran to 402px
 *
 * Every list on the site is a table inside `overflow-x-auto`, and the table
 * carries `min-w-[48rem]` so its columns stay readable. `text-center` on a
 * cell that spans that table centres the message at 384px — in a window 390px
 * wide. What the shop sees is an empty white box, with the sentence explaining
 * why sitting off to the right, in a container they have no reason to think
 * scrolls at all. Every one of these screens passed on desktop, which is where
 * they were looked at.
 *
 * ── How it is centred in the WINDOW instead of the table ────────────────
 *
 * `max-w-[100cqi]`, and the useful part is what happens when there is NO
 * container: a container query length falls back to the small viewport's
 * inline size. So this is one line rather than two dozen wrapper edits.
 *
 *   phone    `w-full` is 768 (the table's min width) → clamped to 390 → the
 *            text centres at 195px, on screen.
 *   desktop  `w-full` is ~940 (the card) → 100cqi is 1280 → no clamp → the
 *            message centres in the card exactly as it always did.
 *
 * Where `cqi` is not understood the declaration is simply invalid, the block
 * falls back to `w-full`, and the screen behaves as it does today. There is no
 * version of this that is worse than what it replaces.
 *
 * `sticky left-0` is the smaller half: if the shop HAS scrolled the table
 * sideways, the message follows rather than sliding away.
 *
 * It renders the `<td>` only. The `<tr>` stays at the call site, because some
 * of these rows carry a key, a colour or a click and none of that is this
 * component's business.
 */
export default function TableEmpty({
  colSpan,
  className = "",
  children,
}: {
  colSpan: number;
  /** The cell's own padding, size and colour. The positioning is not negotiable. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <td colSpan={colSpan} className="p-0">
      <div className={`sticky left-0 w-full max-w-[100cqi] ${className}`}>{children}</div>
    </td>
  );
}
