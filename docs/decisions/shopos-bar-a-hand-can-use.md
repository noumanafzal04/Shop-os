# A bar split the way a hand uses it

**2026-09-04.** Shop's words: *"POS screen mobile pe footer thora sa aur better
— jo kam button use hote like quote, ya reset unko upar le jao sync button ke
sath / baaki 3 neeche / aur teeno full adjust hon."*

---

## What it was

Two rows already — that was the previous pass, which got the bar down from four
rows (191px, a quarter of a 360px screen) to two. But the two rows were made by
**wrapping**, and wrapping packs greedily: it splits wherever the line runs out,
not where the hand wants the split.

So the row a cashier reaches for during a sale contained whatever happened to
fit, and it MOVED. "Add discount" becoming "Discount −Rs 12,500" pushed Hold
onto the next row. A thumb cannot learn a layout that reorders itself according
to how big the last discount was.

## What it is now

Below `sm` the bar is a column of two rows, and each row is stated rather than
discovered:

* **Row one — what a cashier only glances at, plus what they rarely press.**
  The connection pill (flexing, truncating), then Quote, then Reset. Reset is
  at the far right corner, as far as the bar allows from the three below it,
  because it is the one that empties the basket.
* **Row two — the three they press during a sale.** Discount, Hold, Drafts, in
  equal thirds across the full width. A thumb finds a third of a screen without
  looking.

From `sm` up **nothing changed**. Both row wrappers are `sm:contents`, which
dissolves them so the children rejoin the single bar, and `sm:order-1…6` on the
five buttons puts that bar back in exactly the order it has always had:

```
left group (0) · Reset (1, ml-auto) · Discount (2) · divider (3) · Hold (4) · Drafts (5) · Quote (6)
```

## What a third of a screen costs in words

118px, minus a 16px icon and 20px of padding, leaves about 80px of label. Two
things had to give, and the rule for which half goes is the same one used
everywhere else on this bar — **the fact stays, the invitation goes**:

* `Discount −Rs 1,200` keeps the money and drops the word "Discount".
* `Add discount` becomes `Discount`, which is what the button is either way.
* `Quote / Advance` becomes `Quote` (row one, sharing with two other controls).

Every one of them keeps its `title`, which is also its accessible name.

## The guard

`e2e/controls-fit.spec.ts` — "the till's bar splits the way a hand uses it".

It asserts the split by ROW MEMBERSHIP, not by counting rows: Quote and Reset
share the pill's row; Discount, Hold and Drafts share a row below it; the three
are within 1px of each other and cover more than 85% of the screen. Above `sm`
it asserts the opposite — the pill and Drafts on ONE row — so the phone split
cannot leak upward.

Denominator: all six controls must be found and measured, or the rule they
belong to passes by being unasked.

Mutation-proven — `grid grid-cols-3` replaced with `flex`:

```
✘ the till's bar splits the way a hand uses it
  Error: the three are 88 / 66 / 75px — not equal thirds
```

which is exactly the "wrapping decides" behaviour this replaced.
