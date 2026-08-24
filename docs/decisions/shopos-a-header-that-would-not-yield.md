# Nine screens, one bug, and a rule that named the wrong thing four times

**2026-08-25 · panel**

## The pattern, applied again

The restaurant project was added because the mart fixture could not hold a dish,
and the first walk of its two screens found a kitchen board showing dockets for
tabs cancelled six days earlier.

Nine screens were still behind a trade the mart does not have: the forecourt,
fuel deliveries, tanks & pumps, the dispensary, the bay board, vehicles,
warranty claims, reservations. **Never opened by a browser at all.**

Five more projects, one per trade, each signed in as a QA-sweep shop that
actually has it. First walk: **seven of nine screens failed, and all seven were
the same bug.**

## A header that would not yield

```
1298px of content in a 1280px window
```

The top bar is a flex row: hamburger, logo, search icon, the search box, and a
group of controls on the right. The right group is `shrink-0` **on purpose** —
controls that squash are worse than useless. The search box was pinned at
`xl:w-[430px]`.

So nothing in the row was willing to give way. On a shop whose header carries
one control more than the mart's, the row could not fit 1280 and **the whole
page scrolled sideways** — on every screen that shop has.

The fix is two classes: `min-w-0` on the search wrapper so it can shrink below
its content, and `xl:max-w-[430px]` instead of a fixed width so it caps rather
than insists.

> A search box that narrows is fine. A page that scrolls sideways is not.

## The rule named the wrong thing. Four times.

The bug was reported the first time — with the wrong culprit. Acting on that
report would have meant "fixing" a panel that was working correctly.

| named | what it actually was |
|---|---|
| a decorative blur, 453px | clipped by an `overflow-hidden` parent — recorded before today |
| a table in its own `overflow-x-auto` box | same — recorded before today |
| **`header.flex.shrink-0` at 1616px** | the appearance drawer, CLOSED and parked off-screen right |
| **`div.flex-1.transition-all`** | the page container — the symptom |

The third: the rule skipped `position: fixed` elements but not their
**children**, and a closed drawer parked off-screen has static children. Every
screen in the shop was being told its overflow was caused by a panel nobody had
opened.

The fourth: a parent stretched by a child reaches **exactly as far as the
child**, and document order puts the parent first. So `>` kept the container and
never the thing inside it that refused to shrink. `>=` with the deepest winning
a tie walks the report all the way down to something a person can go and fix.

The rule's own docblock had already recorded two misattributions. That is the
point of writing them down: the third and fourth were recognised as the same
shape within minutes instead of being believed.

## What this cost, and what it bought

Five sign-ins, five projects, about three minutes of run time. It found a
defect that made every screen of five whole trades scroll sideways, and it
sharpened the rule twice.

The screens nobody looks at are the ones nothing is measured against.
