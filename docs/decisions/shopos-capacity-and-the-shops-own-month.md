# Capacity bought rather than assumed, and the shop's own month

**Decided and shipped 2026-10-03.** The last four of the six gaps found when
the admin plans/usage model was checked against the code.

## 1. Extra capacity is a row, not a number

A shop on Standard gets ten staff accounts and needs thirteen. Writing 13
into `tenants.limits` gives it thirteen and loses everything else:

| | |
|---|---|
| **Why** is it thirteen? | the screen could say "assigned", and no more |
| **Who** pays for the three? | nothing to invoice — three users at Rs 400 is Rs 1,200 a month with no line to bill |
| **When** does it end? | "five extra until the end of Ramzan" could not be written down, so it was granted for ever and quietly became the deal |

`tenant_entitlements` holds one row per grant. An **add-on** is capacity with
a price. A **temporary grant** is capacity with an end date. A **concession**
is capacity with neither. One table, because three would have been three
places to read before answering *how many staff may this shop have*.

`tenants.limits` is untouched and still the outright assigned value; grants
are added on top, so a screen says **"assigned 10, plus 3 bought"** rather
than one 13 that explains nothing.

Two rules the arithmetic has to keep:

- **Unlimited plus anything is still unlimited.** A null baseline that came
  back as `0 + 3` would turn no ceiling at all into three — the one direction
  a grant must never move a shop.
- **"Until 31 December" means through the 31st.** Dates, not timestamps.
  Comparing against `now()` would end a grant at midnight on the 30th and
  take three staff accounts away a day early, on a date somebody typed
  meaning the opposite.

Ending a grant **ends it today, inclusive** — never deletes. A grant that has
been billed cannot be made never to have existed, and the shop keeps the
capacity for the rest of the day rather than losing accounts mid-shift.

## 2. The shop's month, not the calendar's

A shop that subscribed on the 12th is billed on the 12th. Its included
transactions were counted from the 1st — eleven days out of step with its own
invoice, in **both** directions:

- exhaust the allowance on the 9th, be billed for a fresh month on the 12th,
  and still read "full" for nineteen days;
- or burn the tail of one month and the head of the next inside one invoice
  and never see it.

`PlanLimits::periodStart()` walks the anniversary forward in whole billing
periods, so a quarterly plan counts quarterly rather than in thirds.

**And `addMonthsNoOverflow`, which I got wrong first.** Plain `addMonths`
takes 31 January to **3 March** — the 31st of February does not exist and
Carbon rolls forward. A shop billed on the last day of the month would have
had its allowance reset on a creeping date for ever: 31 Jan, 3 Mar, 3 Apr.
Clamping to the last day of a short month is what a bank does and what the
person who typed the date meant.

Falls back to the calendar month when there is no `subscription_starts_at` —
a tenant with no start has no anniversary, and the 1st is what everybody
means by "this month" in its absence.

## 3. How far back a shop can look — recorded, not enforced

Plans sell a retention window: two years on the cheap one, five on the next.
Nothing in the schema knew that. The word *retention* appeared nowhere in
`app/` except on a rider application, so the promise lived entirely in
whatever a salesperson said on the phone.

`plans.retention_months` records it, the plan catalogue shows it, and the
shop's own Subscription page says what it has — in years where the number
divides, because "sixty months" is not how anybody holds this.

**Nothing is hidden by it, and that is deliberate.** Hiding a shop's own
history is irreversible from where the shopkeeper sits even when the rows are
still there: a shop that opens Sales and cannot find last March does not
think *my plan covers two years*, it thinks its records are lost, and it
rings in a panic. Whether a read is fenced — and whether that is a hard fence
or simply where the date filter starts — is a product decision with a
support cost, and shipping it quietly alongside the column would be the worst
way to make it. `test_recording_the_window_hides_nothing` holds that down
with a four-year-old sale on a two-year plan.

## What ReachableTest caught

The first version of the entitlements work had the model, the arithmetic and
twelve green tests — **and no endpoint**. A capability nobody could use.
That is precisely what that guard exists for, and it is the second time this
week it has been the thing that noticed.

## Proof

`CapacityBoughtRatherThanAssumedTest` (16), `TheShopsOwnMonthTest` (7),
`HowFarBackAShopCanLookTest` (4). Removing the grant arithmetic fails five of
the sixteen and leaves the guard tests passing, which is the shape that says
the fix is pointed at the right thing.
