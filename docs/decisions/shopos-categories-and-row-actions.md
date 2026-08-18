# Drag it, and the detector that only found what was already fixed

**2026-08-18.** Asked to tidy the Categories screen, give it a sub-item view and
let a row be dragged. Two of the three were straightforward. The third turned
into the day's third instance of the same lesson.

## The Categories screen

**Dragging, by pointer events.** `react-dnd` and `react-dnd-html5-backend` are
in `package.json` and **nothing imports either**. They would not have served
anyway: the HTML5 backend does not fire on touch, and a shopkeeper ordering
their menu is doing it on the tablet that runs the till. Pointer events cover
mouse, pen and finger with one set of handlers.

**Midpoints, not row heights.** Rows are not the same height — one being renamed
grows a field, a long name wraps. Multiplying a drag distance by an assumed row
height puts the drop line in the wrong place exactly when the list is hardest to
read. Measuring where the rows actually are cannot drift.

**A sibling group owns its own drag.** Each level renders its own `<Branch>`,
which is what fences a drag to its siblings. Not a simplification: `sort_order`
is only meaningful within a parent, and a drag that crossed parents would be a
MOVE — a different operation with different consequences for the products
underneath.

**Both readings of "sub-item view".** The twisty opens and closes what is under
a category, and a closed one still says **"2 inside"** — collapsing must never
make a branch look like a leaf. And the item count became a **way through**: it
opens the product list already filtered to that category. It had been a dead
number; the only way to see what was in a category was to come to Products and
find it in the filter again.

**Arrow keys as well as the grip**, because a grip is not reachable by keyboard.

## A bug written and caught in the same hour

The screen gained a search box. `sort_order` is written as each row's position
from zero — **do that to a filtered list** and the hidden rows keep the numbers
they had while the visible ones are renumbered on top of them. A shop drags one
category and silently reshuffles the ones it could not see.

The grips now disappear while a search is active — hidden rather than disabled,
because a grip that does nothing when pulled is a broken list, not a locked one
— and the header says so.

> The question is not whether the drag works. It is **what the drag writes.**

## The detector that could only find what was already fixed

`rowAction.test.ts` has guarded row actions since the Aug-17 sweep. Its
detector was:

```ts
const BY_HAND = /className="text-(?:gray-500 hover:text-gray-700|error-500 hover:text-error-600)/;
```

Two literal class strings — **the exact two shapes that sweep had replaced.**
Every other spelling of the same mistake walked past: `text-brand-500
hover:text-brand-600`, `mr-3 text-success-500 …`, `text-theme-xs text-error-500
…`.

**Seventeen were sitting in table cells.** Staff, Suppliers, Riders,
Reservations, Expenses, Income, Inventory, New Sale. Several were rows where
Delete had been swept and the Edit beside it had not, which is worse than
neither — the pair no longer reads as a pair, so the eye stops treating them as
a set and the miss-tap risk goes back up.

> **A detector that recognises the instances somebody already found is not a
> rule. It is a record of one afternoon.**

Third time today. The endpoint audit stripped the strings that carry Laravel's
wiring; `destructive.test.ts` could not read a label written as a ternary; this
one only knew two spellings.

### The rule now

Any `<button>` inside a `<td>` whose className is a literal with no height, no
padding and no size. Scoped to table cells deliberately: a button inside a
sentence ("Change register", "Didn't print") is legitimately a text link, and a
rule that flagged those would be argued with until it was deleted. It carries
its own denominator — a count of `<td>` found — so a broken matcher fails
instead of reporting a clean sweep.

## Touch targets

The till's modal close buttons were `text-gray-400 hover:text-gray-700` around a
20px icon: a bare glyph with no padding, pressed with a thumb, mid-queue.
`MODAL_CLOSE` (36px) and `INLINE_DISMISS` (28px, for a pill or a notice strip
where a 36px button would set the strip's height instead of fitting inside it).

Also added `autoFocus` and `onKeyDown` to the shared `Input`. Their absence is
part of why screens reach past it for a raw `<input>` — a one-field question
should never need the mouse.

## What is left, and why it is a judgement rather than a script

48 bare buttons remain, **none in a table cell**. They are card-list actions
(`ProductFormPage`, `FuelSetupPage`, `TaxGroupsManager`, `CashDrawerPanel`) and
genuine prose links inside sentences (`PosPage`). Telling those apart is reading,
not matching — which is exactly why the rule stops at `<td>` rather than
guessing.

## Gates

Panel **930** green (+27) · eslint 0 errors / 18 warnings · build clean.
Mutation-checked: pointer wiring removed → the drag test fails; the `-1` shift
removed → three fail; one bare row action put back → the sweep fails.
