# "Nothing here yet", off the side of the screen

**2026-09-04.** Found while clearing the responsive backlog; reported to the
user on 2026-09-03 as ~25 places and left for them to decide on. It is a real
defect, so it is fixed.

---

## The defect

Every list on the site is a table inside `overflow-x-auto`, and the table
carries a `min-w-[48rem]` so its columns stay readable. The empty-state row is
one `<td colSpan={n} className="… text-center">`, so its message is centred in
**the table** — at 384px, in a window 390px wide.

Measured at 390 before the fix:

```
/tenant/purchases   "No purchase orders yet."          ran to 474px
/tenant/customers   "No customers yet — they'll …"     ran to 485px
/tenant/coupons     "No coupons yet."                  ran to 402px
```

What a shop sees is an empty white box. The sentence explaining why is off to
the right, in a container they have no reason to think scrolls at all.

Every one of these passes on desktop, which is where they were looked at.

## The fix: one component, and one useful accident of CSS

`src/components/ui/table/TableEmpty.tsx` renders the cell with the message in a
block that is `sticky left-0 w-full max-w-[100cqi]`.

The part that made this a one-line rule rather than two dozen wrapper edits:
**a container query length falls back to the small viewport's inline size when
there is no container above it.** So without declaring `container-type`
anywhere:

| | `w-full` | `100cqi` | result |
|---|---|---|---|
| phone | 768 (the table's min width) | 390 | clamped to 390 — text centres at 195px, on screen |
| desktop | ~940 (the card) | 1280 | no clamp — centres in the card exactly as before |

And where `cqi` is not understood the declaration is invalid, the block falls
back to `w-full`, and the screen behaves the way it does today. There is no
version of this that is worse than what it replaces.

`sticky left-0` is the smaller half: if the shop HAS scrolled the table
sideways, the message follows rather than sliding away.

Applied to **28 cells in 26 files** — 25 found by their `text-center`, plus
three that centre a block inside the cell instead (`ExpensesPage` ×2,
`MoneyEntryTable`).

## The guard, and the blind spot it had first

`e2e/empty-state.spec.ts`. It cannot rely on a fixture being empty, so it
empties the list itself — intercepting the screen's own request and blanking
the `data` array on the way back. Same screen, same envelope, no rows. Filling
a filter with nonsense would test the filter as much as the layout, and some of
these screens have no text filter.

**Two of the six patterns were wrong** on the first run —
`/api/v1/tenant/sales` where the client asks for `/api/v1/sales`. Nothing was
intercepted, and the spec reported *"never drew an empty-state row"* as though
the SCREEN were at fault.

Worse: `/tenant/transfers` **passed** — because that fixture genuinely has no
transfers. A guard that goes green by accident is the one you never look at
again.

So the spec now counts interceptions and asserts the count before it measures
anything:

```
✘ /tenant/transfers never asked for the list this test blanks — the pattern is wrong
```

which is what caught the third wrong pattern. **A pattern that matches nothing
must not read as a screen with nothing to say.**

Mutation-proven — one screen returned to a plain centred cell:

```
✘ /tenant/purchases: "No purchase orders yet." runs to 474px on a 390px screen
  — the shop sees an empty box
```
