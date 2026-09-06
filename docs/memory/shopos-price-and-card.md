---
name: shopos-price-and-card
description: one Price component (a strike-through must be TRUE); shopCover went light; radius.full renders square on 30 small views
metadata:
  type: project
---

2026-09-06 customer-app look pass. Four rules worth keeping:

**A strike-through is a claim.** `Rs 250 / R̶s̶ ̶3̶0̶0̶` was hand-written in seven
files, five designs, and every copy drew it on `original_price != null` — so a
shop filling in a regular price without a sale had the app invent an offer in
its name. `common/ui/Price.tsx` owns it now: `Price`, `OfferBadge`, `hasCut`,
`percentOff`. A cut below 1% returns null so a caller CANNOT draw "0% off". The
badge is amber — the palette says warm is "offers, ratings, the selected tab,
never a button", and three badges were `brand[500]`.

**A placeholder stands in for a photograph; it must not be heavy.** `shopCover`
drew from the palette's FILLS (`#983405`, `#221711`), so two shops in six were
near-black on a white screen — "app bht dark dark feel ho rhi". Six light
grounds spread by HUE now, saturated ink, ≥6:1, and theme-aware via
`useShopCover()`.

**`radius.full` renders as a SQUARE on small views under the new arch.**
Documented in `AppTabBar`, violated in 30 more places. A guard written for the
cart's stepper found all of them. Rule: a style block that fixes a width ≤40 and
asks for `radius.full` is a bug.

**Crowding is a RATIO, not a number.** Every gap on the home card was 4 or 8 —
8 around the logo, 4 between tiles, 8 to the next card. Nothing was individually
wrong; a layout reads as crowded when the space inside a group equals the space
between groups. 4/8/12/16, each step meaning something.

**Why:** all four were invisible to review and visible to the user on first
glance — he reported every one of them before any test did.

**How to apply:** never re-type a price pair or a `% off` pill; import
`Price`/`OfferBadge`. Never `radius.full` under 40pt. See
[[shopos-mobile-customer-shape]] and [[shopos-orders-live-first]].
