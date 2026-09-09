---
name: shopos-white-page-brand-accent
description: "mobile headers are the page colour; the brand is an accent (rider duty fill, wordmark, filter) — no coloured slab behind the notch"
metadata:
  type: project
---

Every mobile header is `c.bg` with a hairline under it: customer home, shop
list (`MarketScreen`), `AccountScreen`, rider board. `FocusedStatusBar` takes
`style={isDark ? "light-content" : "dark-content"}` and `background={c.bg}`.

**Why:** they were brand-filled slabs that painted the status-bar area
themselves (`edges` dropped `top` on purpose). Reported as "primary color
should be white as was first", "top notch issue", "just show branding color".

**How to apply:**
- The brand is spent where it MEANS something: the rider wordmark, the rider
  duty card (the only filled thing on that page, so the fill is the state), the
  search filter disc, the tiles, prices. One filled thing per screen.
- Anything written for a coloured ground had to go with it — `RefreshPill`'s
  `onDark`, the Account sheet's negative-margin overlap, the rider stats card's
  `marginTop: -32`, and a white knob that vanished on a white card.
- The home address was 19pt centred; it is 14pt, left, one line, ellipsised
  ("location name too much big"). The "Hi <name>" line is gone.
- Shop card with 1–2 preview products: tiles share the row (`share: { width:
  undefined, flex: 1 }`) and there is NO ScrollView; at 3+ the fixed 132pt
  strip is right again.

See [[shopos-mobile-customer-shape]], [[shopos-rider-side]],
[[shopos-price-and-card]].
