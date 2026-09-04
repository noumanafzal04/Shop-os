---
name: shopos-bar-a-hand-can-use
description: POS footer split is STATED, not wrapped — row 1 pill+Quote+Reset, row 2 Discount/Hold/Drafts in equal thirds
metadata:
  type: project
---

2026-09-04. Shop: *"jo kam button use hote like quote, ya reset unko upar le jao
sync button ke sath / baaki 3 neeche / aur teeno full adjust hon."*

**Why two rows wasn't enough:** the previous pass got the bar from four rows to
two — but by WRAPPING, which packs greedily. "Add discount" becoming
"Discount −Rs 12,500" pushed Hold onto the next row. A thumb cannot learn a
layout that reorders itself according to the size of the last discount.

Below `sm` the bar is a column: row one = connection pill (flex-1, truncating) +
Quote + Reset (far corner — it empties the basket); row two = Discount / Hold /
Drafts as `grid grid-cols-3`. From `sm` up **both wrappers are `sm:contents`**
and `sm:order-1…6` on the five buttons restores the old single-row order
exactly — the desktop bar is untouched.

Label rule when a third of a phone is 118px: **the fact stays, the invitation
goes.** `Discount −Rs 1,200` keeps the money, drops the word; `Add discount` →
`Discount`; `Quote / Advance` → `Quote`. Every `title` kept (it is the
accessible name).

Guard asserts ROW MEMBERSHIP, not a row count, plus equal widths within 1px and
>85% screen coverage; above `sm` it asserts one row so the phone split cannot
leak upward. Mutation: `grid-cols-3` → `flex` gives "the three are 88 / 66 /
75px — not equal thirds".

Related: [[shopos-responsive-backlog]] · [[shopos-pos-ux]] · [[shopos-half-a-rule]]
