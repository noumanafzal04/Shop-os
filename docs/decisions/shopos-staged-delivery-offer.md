# Nearest first, widening

**Date:** 2026-09-06
**Status:** shipped

## The problem

The platform pool was an open board. The moment a shop accepted, every platform
rider within eight kilometres could see the job and the first to tap took it.
The rider four hundred metres away and the rider seven kilometres away had
exactly the same claim, so the food went to whoever happened to be looking at
their phone — and the customer paid for it in minutes.

## Why a radius, not "the three nearest"

"Offer it to the three nearest, then the next five" needs a table recording
which riders were offered what, kept in step with riders going offline
mid-offer. A widening radius achieves the same thing — the closest get first
refusal — with one nullable column and no state to fall out of step. It also
degrades honestly: if nobody within three kilometres wants it, the answer is
not "ask three more people", it is "look further", which is what a dispatcher
would do.

`OFFER_STAGES = [[0, 3.0], [30, 6.0], [90, null]]`, where null means "as far as
this trade reaches" — food 5km because it goes cold, pharmacy 7, mart 8, retail
12.

## What was half-built, and what that cost

The migration and the service constants shipped; the engine did not.

- **`app/Jobs/WidenDeliveryOffer.php` did not exist** while `RiderService`
  imported it at line 10 and dispatched it at line 959. The first shop to
  accept a platform delivery after that deploy would have thrown.
- **`OrderService` still called `offerToPool($order)`** — one rung of the
  ladder, which alone is the flat eight-kilometre board the staging replaced.
- **The board did not read the radius at all.** `openOffers` filtered on a
  fixed `POOL_RADIUS_KM` from the RIDER. So the staging lived only in the
  notifications: riders further out were told late and still found the job on
  their board the whole time. A queue with no queue in it.

## The bugs found while wiring it

**A job handed back was invisible for ever.** `accept()` nulls the radius, and
a null radius means "not on the board". A rider who accepted and then declined
left the order unassigned, open, and unreachable by every board in the city —
permanently, because nothing else ever wrote that column again. It would have
sat there until a shop noticed.

`reopenOffer()` puts it back at the width the CLOCK has reached, derived from
`offered_at` rather than stored, because a stored stage and a queue that ran
late are two clocks and two clocks disagree. Narrowing back to three kilometres
would hide the job from riders who could see it a minute ago, to re-run a
countdown that has already finished.

**`JOB_RELATIONS` omitted `business_type`.** A column left out of a named
select comes back null rather than missing — exactly the trap that list's own
docblock warns about — so `maxRadiusFor()` fell through to the 8km default for
every shop. A retail order handed back came onto the board at eight kilometres
instead of twelve. The test that caught it asserted the NUMBER; a test
asserting "a radius was written" would have passed.

**`offered_at` had no cast.** `widestReached()` asks it for `diffInSeconds`,
and an uncast column is a string that answers by fataling.

## Two decisions worth stating

**The give-up notice has its own timer.** `TellShopNobodyTookIt` is dispatched
once at the start rather than hung off the end of the widening chain, because
that chain can end early and legitimately — a shop whose ceiling is below the
next stage stops widening because there is nowhere further to look, not because
it has given up. Off the chain it would fire at ninety seconds for a food shop
and three minutes for a tyre shop, which is the clock measuring the wrong
thing.

**Orders in flight on the day of the deploy keep the old flat radius.** A
strict "no radius, not on the board" rule would have dropped every already-
confirmed delivery off every board that morning. `offered_at IS NULL` is the
marker that staging never ran for that row, and it is distinguishable from a
closed offer, which keeps its `offered_at`.

## Evidence

- Backend 2655 tests (2653 passed, 2 skipped), **exit 0**
- 22 new tests in `StagedDeliveryOfferTest`
- **18 mutations, 15 caught.** The three misses are equivalent mutants: every
  state they guard is guarded twice (accepting always closes the offer, so a
  `rider_accepted_at` check and a `offer_radius_km` check catch the same rows).
  The first run caught only 10 of 18 and the five genuine gaps it exposed —
  the trade ceiling in `widestReached`, the never-offered guard in
  `reopenOffer`, the closed-but-unassigned state, and the narrowing case in the
  widening job — are all now tests.
