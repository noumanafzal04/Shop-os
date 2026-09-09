---
name: shopos-page-nobody-could-open
description: "the categories screen was unreachable on live (4 > 4 was false); marketplace/categories returns every trade AND its business_category values"
metadata:
  type: project
---

`CategoriesScreen` shipped unopenable. Its only entry was a home tile drawn
under `business_types.length > tradeTiles.length` — the server sends the trades
that HAVE shops, live returns four, `HOME_TRADES` is four, so `4 > 4` was false.
The tile is unconditional now and `screenReachable.test.ts` fails if the line
above it ends in `&&`, `?` or `||`.

**Why:** the condition asked "is there more than the grid shows" against a list
that answers a different question. The page is also two levels now — garments,
footwear, electronics, cosmetics and toys are ONE `business_type` (`retail`);
grocery and supermarket are `mart`. New `GET /marketplace/categories` returns
every selectable trade plus its `business_category` values with shop counts
(zeros sent on purpose, one grouped query, legacy codes folded by
`BusinessTypes::primary`). `GET /marketplace/shops` filters on
`business_category` — EXACT, because `mobile_accessories` contains `mobile`.

**How to apply:**
- Never gate a trade list on `features.marketplace` — it is **false for
  pharmacy** by default. The gate is `products || services` (Finance is the only
  exclusion) plus any trade that already has visible shops.
- `shops_count > 0` decides what may be pressed, at both levels; an empty trade
  says "Coming soon" and draws no chips.
- A test that asserts today's CONFIGURATION is not a rule: two geo tests
  asserted "no provider key" and failed the day a key was set.

See [[shopos-offered-must-be-reachable]], [[shopos-job-offered-must-be-doable]],
[[shopos-two-elements-not-one-moved]], [[shopos-keys-out-of-the-repo]].
