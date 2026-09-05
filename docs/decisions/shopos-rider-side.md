# The rider side

**2026-09-06.** The half of the mobile pivot that did not exist. This is what
was built, and — more usefully — the shape decisions that keep it from breaking
the shops already running on the delivery flow it sits inside.

---

## 1. A rider is a PERSON. `riders` stays a shop's row.

The table that existed was `riders`: `tenant_id · name · phone · is_active`.
A contact card. No login, no identity, no way to be the same human at two
shops. A shop that hands deliveries to its cousin has exactly that and needs
nothing more, and **that must keep working untouched** — which it does.

So the person is a NEW table, `rider_profiles`, one row per user, outside
tenancy. The bridge is `riders.rider_profile_id`, nullable:

```
null  the phone-call rider that exists today
set   the same person, holding the app
```

`orders.rider_id` still points at `riders` and is still the ONE answer to "who
is carrying this". The panel's assignment screen, the customer's tracking
payload and every existing test go on reading one column.

A platform rider who takes a pool job gets a `riders` row created in that shop
at the moment they accept. That is what keeps the single column true across two
populations.

**The rider id a human says out loud** is `rider_profiles.rider_code` —
`RDR-000123`. A shop adds an app rider by typing that code, never by searching
names: a searchable directory of riders is a searchable directory of strangers'
phone numbers.

## 2. `OrderStatus` was not touched

The enum, its `nextStates()` table, every transition test and the panel's status
buttons are unchanged. The rider's leg is TIMESTAMPS:

```
rider_assigned_at   the shop, or the pool, gave it to somebody
rider_accepted_at   they said yes on their phone
picked_up_at        they have it            → advance() to out_for_delivery
delivered_at        it changed hands        → advance() to completed
```

Two of the four also move the order status, through the EXISTING
`OrderService::advance()`. Adding rider states to `OrderStatus` would have made
every shop's panel, every transition test and the offline till learn a
vocabulary that only matters to deliveries.

The customer's `rider.stage` now comes from these timestamps rather than the
order status, because those two disagree by design for most of a delivery: an
order sits at `preparing` while the rider is already on the way to collect it,
and "assigned" was the only word the status had for that whole stretch.

## 3. `rider_self_claimed` — recorded, because it cannot be inferred

A hand-back means two different things:

- the rider took it off the pool board → it returns to the pool
- the shop chose this rider → the shop keeps its choice, and is told

Both paths write `rider_assigned_at`, often in the same second, so afterwards
there is no way to tell them apart. The first version of `decline()` guessed
from timestamps and was wrong. It is a column now.

## 4. The fence, written by hand

`RiderProfile` is NOT `BelongsToTenant` — like `AuditLog` — and a rider's
request resolves no tenant at all, so the global scope that protects everything
else protects nothing here. Every query in `RiderService` that crosses from a
rider to an order calls `withoutTenancy()` and then filters by **this profile's
cards**. `myOrder()` is that fence in one place so a new endpoint cannot invent
a looser one.

Mutation-proven: remove the fence and
`test_a_rider_cannot_touch_another_riders_delivery` fails with a 200.

## 5. What a rider sees, and when

Two payload shapes in `RiderJobView`, and the difference is the point of the
file:

- **`offer()`** — before accepting. Where to collect, roughly where it goes
  (`drop_area` = the last two comma-separated parts of the address, or null if
  there is only one part, because a single-line address IS the house), what it
  pays. **No customer name, no phone, no street address.** A job board is
  readable by every online rider in the city.
- **`job()`** — after accepting. Everything needed to knock on the door.

Mutation-proven: put `job()` on the board and
`test_a_job_board_does_not_carry_a_strangers_address` fails.

## 6. The handover code

Four digits, generated when the order goes out for delivery — **not at
checkout**, where it would be a number nobody remembers by the time it matters.
The customer reads it off their order screen; the rider types it at the door.
It is the only evidence the app has that a delivery marked complete reached the
person who paid, and on a cash order that is also when the money moves.

The escape hatch already existed: a shop can still complete an order from the
panel without one, for a customer whose phone is flat.

## 7. Money is DERIVED; only the settlement is stored

What a rider earned (`delivery_fee` on delivered orders) and what they are
holding (`total` on delivered, unsettled, cash orders) are computed from the
orders every time. A stored balance is a second copy of a number the orders
already answer, and the two drift the first time anything is refunded.

`rider_settlements` records only the event the orders cannot: **the shop counted
the money and took it.** Each settled order points back at the row that cleared
it, so "still owed" is one query with no running total to keep true.

Cash in hand deliberately ignores the earnings date filter: "what am I holding"
is a fact about now, and a rider looking at last month must not be told they owe
nothing.

## 8. Identity documents are on the PRIVATE disk

CNIC and licence photographs go to `storage/app/private`, never the `public`
disk whose whole point is a URL that needs no token. They are streamed back
through two authenticated endpoints — the rider's own, and the admin one gated
on `riders.manage`.

`riders.manage` is a NEW platform permission and not folded into
`tenants.create`, because reading a stranger's CNIC and deciding they may stand
at customers' doors holding cash is a decision about a PERSON, not a business.
That is exactly what a platform permission list is for. Proven by
`test_the_queue_needs_its_own_permission`.

## 9. "Realtime" is a poll that says how old it is

There is no websocket server in this product; Reverb is not installed. So:

| screen | interval |
| --- | --- |
| an order waiting for a shop | 20s |
| an order with a rider carrying it | 10s |
| a rider's job board | 15s |
| anything finished | never |

A **silent** poll is worse than no poll: somebody staring at "Preparing" cannot
tell whether the shop has not moved or the phone has not asked, and their next
move depends entirely on which. `RefreshPill` states the age — from the
SERVER's clock, so a phone four seconds behind does not report data as arriving
in the future — and refetches on tap.

The pull-to-refresh spinner is bound to the GESTURE (`usePullToRefresh`), never
to `isRefetching`: on a ten-second poll that would put the indicator on screen
six times a minute over whatever the person had scrolled to.

## 10. Two bugs found on the way, both pre-existing

**`delivery_provider` was a comment with no key.** `ShopSettings` described the
self/platform choice in prose for six weeks; the key was in neither `defaults()`
nor `rules()`, so every read of it got null and the panel had nothing to bind
to. The `promise-in-another-file` class again.

**The `down()` migration failed on MySQL and only on MySQL.** `orders.rider_id`
already carried a foreign key, and MySQL adopted the new `[rider_id, status]`
index to enforce it — dropping the index then fails with *"needed in a foreign
key constraint"*. SQLite, which the test suite runs on, was green from the first
try. Found by running the rollback against a real MySQL database, which is the
entire reason that is worth doing. The fix releases the constraint, drops the
index, and puts the constraint back.

## 11. The bug the edge cases found: a context that was assumed, not set

Writing the edge-case suite turned up something the happy path could never
show, and it is the most serious thing in this whole piece of work.

**A rider closing a delivery had no shop.** `CreateSaleAction` — which
`OrderService::complete()` calls to write the Sale — takes the tenant from
`TenantContext` and the branch from `BranchContext`. That is right for a till
and for the panel, where the person pressing the button is standing in the
shop. A rider is not: their request resolves neither.

It never failed a test because **a test reuses one container across requests**.
`TenantContext` is a scoped singleton, and `ResolveTenant` only ever *set* it —
it never cleared it for a customer, a rider or an admin. So the shop owner's
`assign-rider` call a moment earlier left its tenant behind and the rider's
call quietly borrowed it. Every rider delivery test passed for the wrong
reason.

Three fixes, each mutation-proven:

1. **`ResolveTenant` now clears** the context for a role that owns no tenant.
   Production gets a fresh container per request so this changes nothing
   there — but a queue worker, an Octane process and the test suite all share
   one, and "empty because nobody set it" is not a fence.
2. **`OrderService` runs placement, completion and cancellation as the order's
   own shop**, taken from the order rather than from the ambient context, and
   restores whatever was there afterwards. Both sides or neither: wrapping only
   `complete()` turned a symmetric wrong into an asymmetric one — the hold went
   to one branch and the release to another, and the sale then found nothing to
   take.
3. **An order is finished at the branch that filled it** (`orders.branch_id`),
   not at whatever branch the last request left in `BranchContext`. Same class
   as the hand adjustments that always hit Main and the forecourt tanks that
   belonged to no branch: a write taking its branch from the ambient context
   instead of from the thing being written.

Pinned by `test_an_order_is_finished_as_its_own_shop_at_its_own_branch`, which
is shaped like the accident — the second shop's owner acts, then the rider
finishes the first shop's order.

**The lesson, which is not about riders.** Adding the first caller that is
genuinely outside any tenant is what exposed this. Every path that writes
tenant data from a request that has no tenant — a webhook, a queued job, a
scheduled command — is standing on the same assumption.

---

## Gates

| | |
| --- | --- |
| backend | 2593 tests, 2591 passed, 2 skipped, exit 0 |
| migrations | up → down → up on MySQL AND sqlite, foreign keys intact |
| mobile | tsc 0 · eslint 0 errors · jest 26 suites / 294 tests |
| panel | tsc 0 · eslint 0 errors · vitest 128 files / 1487 tests |
| mutations | 8 removed, 8 failures — fence, OTP, offer payload, route, RefreshPill, and all three context fixes |

## Not built

- No cascade offer engine with accept timeouts (needs queues + Redis). The pool
  is an open board: first accept wins, locked with `lockForUpdate`.
- No map on the customer's tracking screen. The rider's live coordinates are in
  the payload; nothing draws them yet.
- No rider push notifications — `FcmSender` is still on the legacy API Google
  retired in July 2024, and that is a separate piece of work.
- The commission engine remains unbuilt. `rider_settlements` is cash moving
  back to a shop, not the platform charging one.
