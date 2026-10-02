# The rider with no app came back with the cash and nowhere to put it

**Decided and shipped 2026-10-02.** Found while seeding online orders at
volume — the load-test fixture could not produce a rider holding money, and
the reason turned out to be the product, not the fixture.

## The problem

`OrderService::assignRider()` states the design in its own docblock:

> **Model A: no rider app** — the shop drives the status; the rider name shows
> on the customer's tracking.

That is the ordinary Pakistani shop. The boy on the bike is a name and a phone
number on the riders screen. No app, no profile, no login.

Exactly one line in the entire codebase ever wrote `orders.delivered_at`:

```php
// RiderService::deliver() — the rider APP endpoint
$order->forceFill(['delivered_at' => now()])->save();
```

And two things read it:

| Reader | What it does |
|---|---|
| `RiderController::index` | the **Cash held** column on the riders screen |
| `RiderService::settle` | gathers `delivered_at IS NOT NULL` COD orders |

So a shop running Model A finished every delivery through
`advance → completed`, left the column null, and watched the riders screen
report **Rs 0** beside a rider carrying the day's takings. Settle answered
*"This rider is not holding any cash for you."* — for ever, for exactly the
riders the screen was built for.

## Why a green suite never saw it

Four tests covered this money. All four built a rider **with the app**: apply,
upload four documents, submit, admin-approve, go online, invite, accept, pick
up, deliver with the OTP. The one shape nearly every shop actually runs had a
denominator of zero.

Worse, one test asserted the broken behaviour and **explained it away**:

> // The shop completed it from the panel, so nothing set `delivered_at` —
> // and cash held is measured from that. This is the honest limit of
> // Model A: without the app there is no moment anybody recorded.

It was not an honest limit. There is a moment, and the shop records it.

## The decision

Completing a **delivery** order stamps `delivered_at`, in
`OrderService::complete()`:

```php
'delivered_at' => $order->fulfillment_type === FulfillmentType::Delivery
    ? ($order->delivered_at ?? now())
    : $order->delivered_at,
```

Three things that had to be true together:

- **A pickup is never stamped.** Nobody carried it — the customer walked in
  and took it off the counter. Stamping it would put a collection on a
  rider's statement.
- **Never overwritten.** The rider app stamps its own moment immediately
  after calling `complete()`, and that one is truer: it is when the door was
  actually knocked on.
- **A prepaid delivery still puts nothing in a pocket.** The rider carried
  goods, not money; `settle()` filters on `payment_method = cod` and that is
  unchanged.

## Proof

`tests/Feature/TheRiderWithNoAppTest.php` — five tests, three of which failed
before the change and two of which (prepaid, pickup) passed before and after,
which is what makes them worth having. `RiderEdgeCasesTest` keeps its Model-A
test, rewritten to assert the money is there and settleable, with the old
comment replaced by why it was wrong.

`loadtest:audit` gained `theCashOnTheBike`, whose strongest check is the
defect stated as an invariant: *no completed delivery is still waiting to be
called delivered.*
