---
name: shopos-staged-offer
description: rider pool is nearest-first widening; the BOARD is the offer, not the notification; a declined job must be reopened
metadata:
  type: project
---

2026-09-06 SHIPPED. `OFFER_STAGES = [[0,3.0],[30,6.0],[90,null]]` — null = the
trade's ceiling (food 5, pharmacy 7, mart 8, retail 12). `WidenDeliveryOffer`
chains stage to stage; `TellShopNobodyTookIt` runs on its OWN timer at 180s.

**The rule that was missed the first time: the BOARD is the offer.** The staging
was written into the notifications only, so riders further out were told late
and still found the job on their board the whole time — the ordering existed and
changed nothing. `openOffers` filters on `orders.offer_radius_km`, measured from
the PICKUP.

**`accept()` → `closeOffer()` (null radius), `decline()` → `reopenOffer()`.** A
null radius means "not on the board", so a pool job accepted and then handed
back was unassigned, open, and invisible to every board in the city FOR EVER —
nothing else ever wrote that column. It comes back at the width the CLOCK has
reached (`widestReached`, derived from `offered_at`), never at stage 0.

**`offered_at IS NULL` distinguishes "never offered" from "offer closed."** That
is what lets orders confirmed before the deploy keep the old flat radius instead
of vanishing off every board, and what stops a shop's hand-picked rider handing
a job to strangers.

**Watch:** `JOB_RELATIONS` must carry `business_type` — a column left out of a
named select comes back NULL, not missing, so `maxRadiusFor()` silently fell to
the 8km default. And `offered_at` needs its datetime cast or `diffInSeconds`
fatals on a string.

**Why:** three of these were only findable by asserting the NUMBER; a test
asserting "a radius was written" passes on all of them.

**How to apply:** any new order state that ends a delivery must null the radius;
anything that revives one must call `reopenOffer`. See [[shopos-rider-side]].
