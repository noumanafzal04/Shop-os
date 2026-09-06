# One price, one cut, and a card that is not crowded

**Date:** 2026-09-06
**Status:** shipped

## What was asked

Five things, over three messages, all about the customer app's look:

1. "Home page Card desing acha ni hai / products bht sth sth hain achi look ni
   arhi / conjusted sa lg raha / padding spaces issues"
2. "price show krwa discount price kaise kro gy?"
3. "cards py bht dark color use kia huwa jinki images ni / light sa kro / app
   bht dark dark feel ho rhi"
4. "cards edge ks sath q lga diye? / bary shops cards"
5. "Order screen or cart screen ko b again thora revamp kry ga acha sa or
   smothness achi kryn gy"

## What was actually wrong

### The discount price was drawn five ways, and one of them lied

`Rs 250 / R̶s̶ ̶3̶0̶0̶` was hand-written in seven files. They had already drifted —
the strike was `gray[400]` in three and `textMuted` in a fourth; the sale price
was `c.primary` on one card, `c.brand[600]` in a rail and `c.text` on the shop
page; two screens built the string with `"Rs " + n.toLocaleString()` rather than
through `money()`, which is the sixth and seventh copy of a formatter that
exists in one file precisely because a Laravel decimal STRING comes out of the
wrong one as "Rs NaN".

The lie: **every** copy drew the strike-through on `original_price != null`.
The field's own comment says the opposite — "only when there IS a cut, a
strike-through against the same number lies" — and nothing checked it. A shop
that fills in a regular price without running a sale had the app advertise a
discount in its name.

The `% off` badge had the matching fault. `Math.round((1 - price / was) * 100)`
sat inline, so a one-rupee cut on a three-hundred-rupee item rendered **"0% off"**.
And three of those badges were `brand[500]` — the fill on every button in the
app — sitting on a photograph where nothing is pressable.

**Decision:** `common/ui/Price.tsx` owns both shapes. `<Price value was size
tone />` and `<OfferBadge value was percent />`, plus `hasCut()` and
`percentOff()`. The comparison lives there once; a `was` that is not genuinely
higher is not drawn, and a percentage below one point returns null so a caller
*cannot* draw a badge that says nothing. The badge is **amber**, per the
palette's own rule that warm is "offers, ratings, the selected tab — never a
button". `OfferBadge` renders nothing when there is no cut, so callers hand it
any product without asking first.

### The placeholder palette was two-thirds too heavy

`shopCover` picked from six of the palette's FILLS, `#983405` and `#221711`
among them. Each is right on its own; together they were wrong, because on a
marketplace almost nobody has uploaded a logo — so two shops in every six came
out as a near-black block, on a white screen.

**Decision:** the weight moved off the ground and onto the letter. Six light
grounds spread by HUE rather than by lightness, each with a saturated ink, all
at least 6:1. And the set follows the theme now: the old hexes were shared by
both, so the block that was too dark on white was a glare on near-black.
`useShopCover()` supplies the theme; `shopCover(slug, dark)` stays callable from
a test and from a `renderItem` closure.

### Nothing on the home screen had a rhythm

Measured rather than guessed at, every gap on the shop card was four or eight
points: 8 of padding around a 54px logo, **4** between product tiles, 8 to the
next card. No single number was wrong. A layout reads as crowded when the space
INSIDE a group equals the space between groups, because the eye gets no help
deciding what belongs together.

The scale is 4 / 8 / 12 / 16 now and each step means something — 4 inside a
line, 12 between siblings, 16 to the page edge. Tiles went 104×78 at 11.5pt →
132×104 at 13pt: a thumbnail of a photograph became a picture of a dish, which
is the entire reason the strip exists.

The long tail was the one block on the page with **no horizontal padding at
all** — the rails, the grid and the shortcut tiles are all `spacing.md` in from
the glass. The card carried no margin and the list rendering it had none
either, so nothing was deciding.

### `radius.full` on a small view renders as a square

Documented in `AppTabBar` and violated in **thirty** more places — every small
round control in the app was a rounded rectangle. Found by a guard written for
the cart's stepper, then fixed everywhere: a style block that fixes a width and
asks for `radius.full` now carries `min(width, height) / 2`.

### The orders list answered two questions with one rectangle

"Where is my food" and "what did I order in March" are not the same question. A
delivery three streets away and a receipt from last March were the same card
with a different word in the corner, so the one urgent card had to be *found*.

`STATUS_STYLE` held literal hexes — `#eff8ff` on `#175cd3`, four of the seven
states. There is no blue in this app, and those hexes are the same in both
themes: a pale blue-white badge punched into a near-black card. The badge also
printed the database column with its underscores swapped for spaces.

**Decision:** `orders/orderStatus.ts` names the whole vocabulary — label, tone,
whether it is still moving, and where it sits on the journey. Live orders lift
into an `Ongoing` section with a progress track; the rest becomes `Earlier`.
The split is computed from the rows already loaded rather than requested
separately, so an order that finishes while the list is open cannot sit in both.
`stepsFor` drops the delivery leg from a collection order, because a
five-of-six bar stuck at "Ready" looks broken at the exact moment the order is
done and waiting on the customer. `stepOf` returns null for cancelled rather
than drawing it one step from delivered. And every card carries a date, which
none of them did.

### The basket showed letters for photographs it had just been given

Every line drew the derived placeholder — the stand-in for a *missing* photo —
including for items whose photograph was on screen one tap earlier. `CartLine`
carries `image` now, filled at all four builders. Carried on the line rather
than re-fetched: the basket already knows what is in it, and re-reading the
shop's catalogue to find three URLs is a request that can fail and leave the
basket blank.

The empty basket was also a dead end — the cart is a leaf of the tab bar, so
there is no back arrow, and the empty state told somebody to go browsing
without giving them anything to press.

## Evidence

- mobile: tsc 0, eslint 0 errors, **jest 39 suites / 481 tests**
- panel: tsc 0, vitest help 20/20
- **23 mutations, 22 caught.** The one miss is an equivalent mutant:
  `stepOf` guards cancelled twice (an early return and an `indexOf` that cannot
  find it), so removing either leaves the behaviour identical.
- Three findings came from the tests themselves rather than from reading:
  the `radius.full` guard found 30 violations beyond the one it was written
  for; the rupee-string guard reported its own docblock until it learned to
  strip comments; and the render test caught that swapping `hasCut(value, was)`
  back to `was != null` put the whole discount bug back while every
  pure-function test stayed green.
