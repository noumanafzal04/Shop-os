---
name: shopos-placeholder-per-trade
description: product name placeholder is per-trade and per-item-type now (was "e.g. T-Shirt / Haircut" for a chemist and a petrol pump)
metadata:
  type: feedback
---

2026-09-04, user: *"jab product create karte, wahan input title Shirt like this
tarhan ka aa raha — kya business type ke lehaz se placeholder nahi add kar
sakte? Achi suggestion mil jayegi tenants ko."*

**Why:** a placeholder is the cheapest teaching a form does — read before the
label, and it settles the SHAPE of the answer (does the size go in here? the
strength?). One about somebody else's trade teaches the wrong shape or reads as
software not built for this shop.

**How to apply:** `src/modules/catalog/productExamples.ts`. Two questions, in
order — **item type first** (a service is a service in a salon or a workshop,
and the shop already chose it on the same form), then the **primary trade**.
Never a brand: it is somebody's trademark and reads as an endorsement inside
software the shop pays for.

The guard reads its denominator from `TRADE_FEATURES`, so a ninth business type
turns it red instead of quietly getting a T-shirt.

**The general lesson:** `BusinessTypes::examples` sounded like the source and is
not — those are examples of SHOPS ("Grocery", "Barber"), not of products. Check
what a field means before reusing it.

Related: [[shopos-ui-conventions]] · [[shopos-job-offered-must-be-doable]]
