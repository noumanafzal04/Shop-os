# A ride is not an order

**Status:** FLOW ONLY — nothing is built, nothing is migrated. 2026-09-17.

City rides (inDrive-shaped) beside the delivery the platform already runs. This
document is the design and the break-nothing analysis. No code follows from it
until it is agreed.

---

## 1. The one sentence

> A ride has no shop, no `orders` row and no tenant — and the single most
> expensive mistake available here is making it borrow one.

Everything below follows from that. `orders.rider_id` stays the ONE answer to
"who is carrying this delivery", and a ride never writes to it.

---

## 2. THE THING THAT WILL BREAK

"Can this rider be given work" is answered in **three** places today, and they
are three separate copies of one rule:

| # | Where | Form |
|---|---|---|
| 1 | `RiderProfile::isAvailable()` | model predicate — status + online + 5-min freshness |
| 2 | `RiderService::offerBlock()` | the rider-facing *reason* — six named causes |
| 3 | `RiderService::availableNear()` | the dispatch **SQL**, same rule again in a query |

Rides add a fourth condition — *"is this rider on a ride right now"* — and it
must land in all three. Miss one and the failure is silent and different each
time:

- miss **(3)** → a rider halfway across town with a passenger is offered a
  biryani, accepts it, and the food sits for forty minutes.
- miss **(2)** → the board is empty and says nothing. That is the exact bug
  `offerBlock` was written to kill; re-introducing it costs the same support
  thread again ("rider side no order coming").
- miss **(1)** → the shop's panel shows a green dot beside somebody who cannot
  take the job.

This is the `Guards Share A Blind Spot` / `Half A Rule` class. The fix is not
vigilance — it is **one function** both the predicate and the query consult, and
a test that deletes the ride condition and watches all three fail.

`activeJobs()` counts **orders only**. `MAX_ACTIVE_JOBS` therefore cannot see a
ride at all. That is the concrete edge of the same problem.

---

## 3. Money

No gateway exists anywhere in this codebase (verified: zero hits). The passenger
pays the driver **cash, in full**. The platform never touches passenger money.
So the platform's cut has to be taken from the driver, **before** the cash
exists — which is a prepaid driver wallet.

### The three moments

```
  driver sends an offer   ->  CHECK     balance >= commission   (nothing written)
  passenger accepts it    ->  CHARGE    one ledger entry, for ever
  ride cancelled          ->  NOTHING   the charge stands
```

"Commission pehle" means **charged the moment the offer is accepted** — before
the driver has moved and long before any cash exists. Not at offer: a driver who
sends twenty offers and wins two would have paid for twenty.

There is no hold and no reservation. The deduction is real and immediate, so
there is no second number to keep in step with the first:

```
balance = SUM(rider_wallet_entries.amount)
```

That is the whole wallet. `rider_settlements` already states why nothing more is
wanted:

> *"What a rider is owed and what they are holding are DERIVED, never stored ...
> a stored balance is a second copy of a number the orders already answer, and
> the two drift the first time an order is refunded."*

### A cancellation does not give it back

Decided: the charge stands. It is what stops a driver from winning a ride and
dropping it for a better one thirty seconds later, and it is the only lever the
platform has over that behaviour while all the cash is in the driver's pocket.

The refusal is stated to the driver **before** he bids, not discovered
afterwards — a deduction nobody was warned about is a support ticket, and the
same deduction warned about is a rule.

### The rate is frozen on the ride

`commission_charges` already states this law too:

> *"the rate is written at the moment the order completes and never read from
> settings again … a bill that silently re-prices itself is a bill nobody can
> check."*

`rides.commission_rate` and `rides.commission_amount` are snapshotted when the
offer is accepted. Raise the platform rate tomorrow and yesterday's rides do not
move.

### The collusion hole, and the floor

If commission is 10% of the agreed fare, a driver and passenger agree Rs 60 in
the app and Rs 500 in cash. On a 15 km ride the platform earns Rs 6.

```
commission = max( rate% x agreed_fare,
                  rate% x floor_fare,      floor_fare = base + per_km x km x floor_ratio
                  min_commission )
```

Bidding low is allowed — bidding the platform out of the transaction is not.

### Top-ups

No gateway means a top-up is a **claim** that staff approve: an Easypaisa /
JazzCash reference number and a screenshot, reviewed in the admin queue. Shaped
exactly like `rider_documents` review, which already exists and already works.

Approval lag is the operational risk: a driver with an empty wallet cannot work
while he waits. Mitigations, in order of preference — auto-approve under a small
ceiling for drivers with a clean history; a permitted negative float; agent
top-ups in cash.

---

## 4. The ride

```
                    matching
                        |
        +---------------+---------------+
        |                               |
    (offers in)                    (nobody bid)
        |                               |
     assigned  --- commission CHARGED   expired
        |
     arrived
        |
   in_progress
        |
    completed

  cancelled_by_passenger / cancelled_by_driver / no_show
      may terminate matching, assigned or arrived — never in_progress
```

`in_progress` is deliberately a one-way door: once a passenger is in the car the
ride ends by completing, not by cancelling.

### Offers

```
   pending --+--> accepted      (exactly one per ride)
             +--> lost          (siblings, the moment one is accepted)
             +--> expired       (TTL ~90s)
             +--> withdrawn     (driver went offline / took other work /
                                 wallet fell below the commission)
```

### Selection must be atomic

The passenger taps one card while the world moves underneath. In a single
locking transaction:

1. lock the ride; it must still be `matching`
2. the offer must still be `pending`
3. the driver must have **no other active ride and no active delivery**
4. `balance >= commission` — recomputed **here**, never trusted from the figure
   the offer was written with
5. write the `commission` ledger entry, stamp `commission_rate` +
   `commission_amount` + `commission_charged_at` on the ride, set `assigned`
6. every sibling offer → `lost`

Steps 4 and 5 share the transaction opened by the lock in step 1. Two
passengers accepting two offers from one driver in the same second must not
both succeed — that is how a wallet goes negative.

Any step failing means the offer is withdrawn and the passenger is told the
driver is no longer available — never a silent spinner.

---

## 5. Database

### Changed — `rider_profiles`

Fresh migrate is planned, so these belong in the existing migration rather than
a patch on top; they are part of who a rider *is*.

| Column | Why |
|---|---|
| `vehicle_make`, `vehicle_model`, `vehicle_colour` | a passenger has to recognise the car walking up to it. `vehicle_type` and `vehicle_registration` already exist |
| `takes_rides` (bool) | carrying parcels and carrying **people** are different consents. A food rider must not be conscripted |
| `rides_suspended_at` + reason | a safety suspension that does not also stop deliveries, and the reverse |

`takes_rides` must ship **with its control on day one**. `is_platform` shipped
without one, defaulted false, and became "a trap with no exit" — riders
invisible to the pool for ever with no screen able to say why. That is a
documented bug in this repo; repeating its shape would be careless.

`vehicle_type` gains `rickshaw`, and gains a rule: **bike, rickshaw and car may
carry a passenger — cycle and van may not.**

### New — seven tables, none of them tenant-scoped

Like `rider_profiles` and `AuditLog`, these sit outside tenancy. That means the
global scope which protects everything else **is not here**, and every read
needs a hand-written fence. A passenger's home address and phone leaking is
worse than a dining table leaking.

| Table | Holds | Notes |
|---|---|---|
| `ride_fares` | `city_id` x `vehicle_type` → `base_fare`, `per_km`, `min_fare`, `commission_rate`, `min_commission`, `floor_ratio`, `is_active` | the backend-set price. `cities` already exists |
| `rides` | passenger, driver (null till assigned), pickup/drop lat+lng+text, `distance_km`, `recommended_fare`, `passenger_offer`, `agreed_fare`, status, `commission_rate`, `commission_amount`, `commission_charged_at`, stage timestamps, cancel by + reason | the spine |
| `ride_offers` | ride x driver x `amount` x status x `expires_at` | `unique(ride_id, rider_profile_id)` — one live offer per driver per ride |
| `rider_wallet_entries` | `type`, signed `amount`, `ride_id` (nullable), ref, note, `created_by` | append-only ledger. `unique(ride_id)` = **one charge per ride for ever**, copied from `commission_charges.order_id` |
| `rider_topups` | amount, method, reference, proof path, status, `approved_by` | the admin queue |
| `ride_ratings` | ride, direction, stars, comment | both ways |
| `ride_locations` *(optional)* | driver breadcrumbs during `in_progress` | the only real evidence in a dispute. Costs write volume; decide before Phase 2 |

Wallet entry types: `topup`, `commission` (−), `bonus` (+), `penalty` (−),
`refund` (+), `adjustment` (±). There is no `hold` and no `release`: the charge
is immediate and final, so nothing is ever reserved. `refund` exists for staff
correcting a mistake — not for cancellations.

### Not a new table

A separate `ride_vehicles` was considered and rejected for v1: one rider, one
vehicle. The verification of that vehicle already has a home — `rider_documents`
has `unique(rider_profile_id, type)` and a review flow. Multi-vehicle is a
later migration, not a speculative table now.

---

## 6. Break-nothing checklist

| # | Existing thing | What rides must respect |
|---|---|---|
| 1 | `isAvailable()` / `offerBlock()` / `availableNear()` | the fourth condition, in **all three**, from one shared function |
| 2 | `activeJobs()` + `MAX_ACTIVE_JOBS` | counts orders only; a ride is invisible to it |
| 3 | `orders.rider_id` | stays the one answer for deliveries. A ride writes **nothing** to `orders` |
| 4 | `riders` unique `(tenant_id, rider_profile_id)` | a ride mints **no** shop card — there is no shop. No collision, and none may be introduced |
| 5 | `RiderSettlement` | tenant-scoped: one **shop's** cash. The ride wallet is platform-level. Never summed together, never shown in one total |
| 6 | `RiderService::earnings()` | reads orders only. Add rides or the earnings screen quietly under-reports |
| 7 | `isPlatformApproved()` | shop-vouched riders may not carry a stranger's goods. Carrying a stranger's **person** is stricter still — platform approval + verified vehicle, no exceptions |
| 8 | `is_platform` | delivery-pool membership. Rides use `takes_rides` — do not overload one flag with two consents |
| 9 | `RIDER_BOARD_POLL_MS` (15s) | stays 15s for the delivery board. Ride screens poll on their own clock |
| 10 | `/api/v1/rider/*` route group | `role:customer`, no tenant middleware. Ride routes join it and inherit the same hand-written fences |
| 11 | Help Centre x3 | panel `help/content.ts`, mobile `HelpScreen.tsx`, Partner. Standing rule |

**Nothing above is a rewrite.** Every item is an addition to a layer that
already got this right once.

---

## 7. Real time

A correction to an earlier, over-cautious estimate: WebSockets are **not**
required to ship a pilot.

| Screen | Clock |
|---|---|
| delivery board (today) | 15s — unchanged |
| passenger waiting for offers | ~3s |
| driver approaching pickup | ~5s |
| ride in progress | ~5s |

Polling at those rates in one city is fine. Sockets are the Phase 5 upgrade, and
they improve delivery too.

---

## 8. Phases

| # | Phase | Why here |
|---|---|---|
| 0 | fares, wallet ledger, top-up queue, `takes_rides` + its control | money rails first — nothing else can be written without them |
| 1 | request → offers → counter → atomic selection | the negotiation core |
| 2 | arrived → start → complete → charge | the ride itself |
| 3 | cancellation, no-show, share-trip, SOS, ratings | safety |
| 4 | admin: live monitor, disputes, driver earnings | ops |
| 5 | sockets, surge, scheduled rides | later |

Start bike-only, one city.

---

## 9. Not ours to decide

| Item | Note |
|---|---|
| Provincial ride-hailing registration + passenger insurance | carrying people is a different licensing burden from carrying parcels. Confirm before Phase 2 |
| Background location | Play Console needs a separate declaration and a **video review**. Long lead time — begin before it blocks |
| SOS needs a human | a button with nobody behind it is worse than no button |
| Supply density | one city, or the offers screen is empty and stays empty |
| **A passenger who cancels, or never turns up** | The rule above is "no return", and for a driver who drops a ride that is exactly right. This is the other case: the driver bid, paid, drove to the pickup and the passenger vanished. He is out the commission **and** the petrol on somebody else's decision, and it is the single most-cited reason drivers leave a platform - which is the opposite of the reason rides are being added at all. Worth deciding before Phase 3, not after: refund when the cancel is the passenger's, or charge the passenger a no-show fee that covers it. Either way the driver is not the one who pays |

---

## 10. The map, and a decision this reverses

`src/common/maps.ts` states the current position plainly:

> *"A map inside the app means a native module, a tile bill, and an API key in a
> build — for a picture the phone's own maps app draws better, with the person's
> saved places, their traffic, and turn-by-turn voice they already trust."*

**There is no map inside this app.** Coordinates are handed to whatever maps app
the phone has. For delivery that is not merely acceptable, it is *better* — and
the reasoning above is correct and should not be thrown away.

Rides split that decision in two:

| Side | Needs an in-app map? | Why |
|---|---|---|
| **Passenger** | **Yes** | Dropping a pin on a lane with no address, and watching the car approach, are the product. A hand-off cannot do either |
| **Driver** | **No** | Turn-by-turn belongs to Google Maps, which every driver in Pakistan already trusts. `mapsUrl()` keeps working, unchanged |

So the reversal is **narrow**: one map, on the customer side, in the ride flow
only. Nothing else in the app gains one.

| Option | Verdict |
|---|---|
| `react-native-maps` | **Recommended.** The standard, New-Architecture ready, smooth marker movement. Costs: a native module, tiles billed by Google, and the API key baked into the build — which is already the case and already needs provider-side restriction |
| WebView + MapLibre / OSM | Cheaper tiles, no Google. Worse at the one thing that matters — a marker moving smoothly — and WebView is not installed either, so it is not a smaller dependency |
| Static map images | Fine for picking a pin, useless for live tracking. Not a whole answer |

### The sheet over the map

Every ride app draws a **draggable sheet** over the map. This app cannot, cheaply:
there is no Reanimated and no gesture-handler, and `core/ui/BottomSheet` is a
**dismissible modal** whose PanResponder drag lives on the header only. It is not
a multi-snap persistent panel.

Decision: **a fixed panel over the map**, its height changing with the ride
stage rather than with a finger. Less fashionable, and it removes the single
biggest source of gesture bugs on a screen people use while moving.

---

## 11. Customer side — where a ride lives

The tab bar is full and correct: **Home · Grocery · Cart · Orders · Account**,
with the basket as the centre disc. A sixth tab would break that composition and
put a rarely-tapped thing beside four daily ones.

Rides enter at the top of **Home** as a service row instead — the Careem / Bykea
shape, and the only one that survives parcel being added later:

```
  Home
  ┌──────────────────────────────────────┐
  │  [pin] Model Town, Lahore        v   │
  ├──────────────────────────────────────┤
  │   Food     Grocery      Ride         │   <- the service row
  │   (o)       (o)         (o)          │
  ├──────────────────────────────────────┤
  │  shops, offers, the aisle ...        │
```

Tapping **Ride** pushes a stack of its own. The tab bar hides inside it, the way
Checkout already presents.

| # | Screen | What it is |
|---|---|---|
| 1 | `RideWhereTo` | pickup pre-filled from position, destination searched or pinned |
| 2 | `RideFare` | map + panel: recommended fare, **your offer**, vehicle chips (bike / rickshaw / car), a note for the driver |
| 3 | `RideOffers` | drivers arriving live — name, rating, vehicle, ETA, price. The signature screen; one card per offer, and the count must be honest while it is still zero |
| 4 | `RideTracking` | assigned → arrived → in progress. Map + fixed panel. Call, share trip, SOS |
| 5 | `RideDone` | what was agreed, and the rating |

Plus an **active-ride bar** pinned above the tab bar once a ride exists, so a
passenger who wanders back to Home can return in one tap. Delivery gets the same
bar for free.

### Taken from the reference screens (2026-09-17)

Three mechanics the first sketch of this flow missed, and all three matter:

**1. "Raise fare" when nobody bids.** The waiting screen is not a spinner — it
says how many drivers are looking at the request, and offers a stepper to push
the price up. That is the whole answer to an empty offers list, and without it a
passenger's only move is to cancel and start again.

**2. Offers arrive as cards over the map, not a separate list screen.** One
driver at a time: photo, name, rating, vehicle, ETA, distance, their price, and
**Decline / Accept**. A list implies all the offers are in; a card admits they
are still arriving.

**3. Vehicle class is a priced list, not a chip row.** Each class shows its own
fare, seats and ETA together, so the choice is made on all three at once —
bike (1 seat), rickshaw (3), car (4). Chips can only carry a name.

Also adopted: the fare stepper with **"Recommended fare"** stated underneath it,
`Recommended / Faster / Cheaper` as the sort of the offers, and a
"Where are you going?" card with **From / Where to** and recent destinations —
which is `RideWhereTo` above, confirmed rather than changed.

### Colour

The direction given with those screens is **#10B981 green for the customer side
and #EF4444 carmine for the rider side** — recorded, not built. It is one edit
in `mobile/src/modules/mode/palettes.ts`, which is the only file that knows the
mapping.

One thing must be settled before that swap, not after: **#EF4444 is the danger
colour.** `variant="danger"`, destructive confirms and error text are already
red. A rider side themed carmine makes "delete this" and "this is the app" the
same hue, and the first thing to suffer is a confirmation nobody reads
carefully. Either the rider primary moves off pure red, or `danger` moves to a
hue of its own first.

---

## 12. Rider side — the revamp

Four screens exist: `RiderHomeScreen` (board), `RiderJobScreen`,
`RiderEarningsScreen`, `RiderApplyScreen`. Tabs are **Deliveries · Earnings ·
Account**.

### One board, two kinds of card

A rider does not want two boards. Their question is "what can I earn right now",
asked once — and `offerBlock` already exists to answer "why is this empty" in
exactly **one** place. A second board means that answer is written twice, which
is the bug it was built to kill.

So the board keeps one list with two card shapes, because the actions genuinely
differ:

```
  DELIVERY                          RIDE
  ┌────────────────────────┐        ┌────────────────────────┐
  │ Ali Karahi    1.2 km   │        │ Railway St -> Model Tn │
  │ Model Town, House 4    │        │ 7.2 km  ·  2 people    │
  │ Rs 180 delivery fee    │        │ Offered   Rs 500       │
  │                        │        │ Commission Rs 50       │
  │      [  ACCEPT  ]      │        │ [ SKIP ]  [ BID Rs__ ] │
  └────────────────────────┘        └────────────────────────┘
        first come, first served          you bid, you may lose
```

### What changes, screen by screen

| Existing | Revamp |
|---|---|
| Tab label **"Deliveries"** | becomes **"Work"** — the label turns into a lie the moment rides exist |
| Tab **"Earnings"** | becomes **"Wallet"**: balance first, top up, the ledger, and earnings as a section below. With a prepaid model the urgent question is "can I bid", not "what did I make" |
| `RiderHomeScreen` | balance pill in the header, always visible — a driver at zero must learn it *before* he reads a job he cannot bid on. Board holds both card types. Empty state gains the ride reasons |
| `RiderJobScreen` | untouched, still the delivery job |
| *new* `RideJobScreen` | map-first, stage buttons: On my way / Arrived / Start / Complete. Navigation hands off to Google Maps via `mapsUrl()` |
| `RiderEarningsScreen` | folds into Wallet |
| `RiderApplyScreen` | gains vehicle make / model / colour, and the `takes_rides` consent **with its control** |
| *new* `WalletTopUpScreen` | amount, method, reference number, screenshot — then the admin queue |

### What does not change

Colours are already right: customer leaf-green, rider ember-orange, chosen by
`paletteFor` in `modes/palettes.ts`. Ride screens inherit both without a line of
new theme code.

The house rules still hold on every new screen — no `radius.full` on small
views, no `stickyHeaderIndices`, no native-driver `Animated.event` on `onScroll`.
A map screen is exactly where somebody reaches for all three.
