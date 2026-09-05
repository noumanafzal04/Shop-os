---
name: shopos-rider-side
description: "2026-09-06 SHIPPED: rider = a USER (rider_profiles) beside the untouched tenant `riders` row; OrderStatus never changed; the fence is hand-written; realtime = an honest poll that states its own age"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-09-05T19:11:46.347Z
---

**The half of the mobile pivot that did not exist.** Built end to end: backend,
rider screens in the customer app, shop-side invite + cash settlement, admin
approval queue. Full write-up in `docs/decisions/shopos-rider-side.md`.

## The shape decisions that must not be undone

**A rider is a PERSON; `riders` stays a shop's row.** `rider_profiles` is new,
one per user, OUTSIDE tenancy, carrying `rider_code` (`RDR-000123` — the id a
human says out loud, and the only way a shop may add an app rider, because
search-by-name would be a directory of strangers' phone numbers).
`riders.rider_profile_id` is the nullable bridge: null = the phone-call rider
that exists today and still works untouched, set = the same person with the app.

**`orders.rider_id` never moved.** It is still the ONE answer to who is carrying
an order. A platform rider taking a pool job gets a `riders` row created in that
shop at the moment of accept, which is what keeps that true across two
populations. See [[shopos-mobile-is-customer-and-rider]], whose plan this
follows.

**`OrderStatus` was NOT touched.** The rider leg is four timestamps —
`rider_assigned_at`, `rider_accepted_at`, `picked_up_at`, `delivered_at` — and
two of them drive the EXISTING `OrderService::advance()`. The customer's
`rider.stage` reads the timestamps, not the status, because those two disagree
for most of a delivery (an order sits at `preparing` while the rider is already
on the way to collect it).

**`rider_self_claimed` is a column because it cannot be inferred.** Pool-claim
and shop-assign both write `rider_assigned_at`, often in the same second, and a
hand-back means opposite things for each. The first `decline()` guessed from
timestamps and was wrong.

**The fence is hand-written.** `RiderProfile` is not `BelongsToTenant` (like
`AuditLog`) and a rider's request resolves no tenant, so the global scope
protects nothing — every crossing goes through `RiderService::myOrder()`. Same
shape as the bug in [[shopos-wall-between-shops]].

**Two payloads, not one.** `RiderJobView::offer()` before accepting carries no
name, no phone, no street address — a job board is readable by every online
rider in the city. `job()` after accepting carries everything.

**Money is DERIVED; only the settlement is stored.** Earned and cash-in-hand
come from the orders every time. `rider_settlements` records the one thing they
cannot: the shop counted the cash and took it. Cash-in-hand ignores the
earnings date filter on purpose — "what am I holding" is a fact about now.

**Identity documents are on the PRIVATE disk**, streamed behind auth. New
platform permission `riders.manage`, deliberately NOT folded into
`tenants.create`: reading a stranger's CNIC is a decision about a PERSON.

## Two bugs found on the way — both pre-existing, both a named class

**`delivery_provider` was a comment with no key.** `ShopSettings` described the
self/platform choice in prose for six weeks while the key was in neither
`defaults()` nor `rules()`. [[shopos-promise-in-another-file]] again.

**The `down()` migration failed on MySQL and ONLY on MySQL.** `orders.rider_id`
already had a foreign key; MySQL adopted the new `[rider_id, status]` index to
enforce it, so dropping that index throws *"needed in a foreign key
constraint"*. SQLite — what the suite runs on — was green from the first try.
**Standing lesson: run a rollback against real MySQL, not just the test
driver.** Related to [[shopos-screen-testing]]: the environment the tests use is
not the environment that ships.

## Realtime, honestly

No Reverb, so no websockets. Polling: **10s** while a rider carries an order,
**15s** on the rider board, **20s** otherwise, **never** once finished. A silent
poll is worse than no poll — you cannot tell a still shop from a still phone —
so `RefreshPill` states the age from the SERVER's clock and refetches on tap.
The pull spinner binds to the GESTURE (`usePullToRefresh`), never
`isRefetching`, or a 10s poll shows it six times a minute.

New mobile guards: `routesExist.test.ts` (every `navigate("X")` and every
`route:` in the side menu is a registered screen — nothing else typechecked
those strings) and `refreshPill.test.ts`. Both mutation-proven.

## Still not built

Cascade offer engine with accept timeouts (needs queues/Redis — the pool is an
open board, first accept wins under `lockForUpdate`); a map on the customer's
tracking screen (coordinates are in the payload, nothing draws them); rider push
(FcmSender is still on the legacy API Google retired July 2024); and the
**commission engine** — `rider_settlements` is cash moving back to a shop, not
the platform charging one.
