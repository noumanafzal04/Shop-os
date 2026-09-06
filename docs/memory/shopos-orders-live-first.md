---
name: shopos-orders-live-first
description: orders list splits Ongoing/Earlier from loaded rows; status vocabulary in one file; pickup has no delivery leg
metadata:
  type: project
---

2026-09-06. The orders list answered two questions with one rectangle: "where
is my food" and "what did I order in March". `STATUS_STYLE` held literal hexes
— four of seven states blue, in an app with no blue, identical in BOTH themes,
so a pale blue-white badge was punched into a near-black card. The badge also
printed the DB column with underscores swapped for spaces.

`src/modules/orders/orderStatus.ts` now owns label + tone + `live` + position:
`statusLook`, `statusColors`, `stepOf`, `stepsFor`, `placedAt`.

Three rules that are easy to get wrong again:
- **`stepsFor` drops `out_for_delivery` for a pickup order** — a five-of-six
  bar stuck at "Ready" looks broken at the exact moment the order is done and
  waiting on the customer.
- **`stepOf` returns null for cancelled** — a position would draw it one step
  from delivered.
- **The Ongoing/Earlier split is computed from rows already LOADED**, never a
  second endpoint: an order that finishes while the list is open would then sit
  in both sections.

Also: `CartLine` carries `image` (filled at all four builders) — the basket was
drawing the missing-photo placeholder for items whose picture was on screen one
tap earlier.

**Why:** these are correctness bugs wearing a design complaint's clothes.

**How to apply:** any new order state goes in `orderStatus.ts` first; the
screens read it. See [[shopos-price-and-card]].
