# Three months of paying

**2026-10-11 · at the user's word · NOT PUSHED until they say**

*"test everything with real data on UI and also on backend side — create
plans, create tenant, uska plan 2–3 month chalao, update karo, check karo
process sahi chal raha — or pricing."*

Every rule of billing had a test of its own and all of them passed. None of
them let a calendar turn. So one shop was walked through a quarter of paying,
twice:

- **on the server, with the clock moved** — `AShopPaysForThreeMonthsTest`
  (7 tests, 211 assertions, 28/28 mutations killed);
- **through the real screens** — journey stage R,
  `e2e/journey/29-three-months-of-paying.spec.ts` (19 cases, admin and owner).
  A browser cannot turn a calendar and nothing touched the database: the
  shop is CREATED in the past through the billing window the admin can
  already state, and brought forward one payment at a time.

## What it found

### 1. A blank amount was booked as the plan's full price

Both forms say it in so many words — *"Opening payment — leave the amount
blank if nothing was taken yet"*, *"leave amount blank for a
free/complimentary assignment"* — and both send no payment when the box is
blank. `AssignPlanAction` then wrote one anyway, for the plan's price
(`$payment['amount'] ?? $plan->price`).

So a shop signed up on a promise to pay next week was in the ledger as
collected, in cash nobody held, on the day it was created; a free month was
revenue; and "Collected this month" was what was paid plus what was not
asked for.

**Now:** a payment row is written only when an amount was given. The ledger
holds money somebody typed in, and nothing else.

### 2. Three boxes on the Plans screen saved nothing

*Selling offline is included*, *Days a till may sell offline* and *Allowed
over* (bills past the month's figure) were sent by the form since the ladder
was drawn. The request rules listed none of them, so `validated()` dropped
them and answered "Plan updated"; `PlanResource` did not return them either,
so every plan's card read "Selling offline: No" — including the three seeded
with it. Offline selling, the one capability a plan gates, could be set by the
seeder and by nothing else.

**Now:** accepted, saved, returned (`limits.offline_selling`,
`limits.offline_days`, `grace_orders_month`).

### 3. Paying late moved the month, and gave the late days away

A renewal "after expiry" started on the day it was typed. For a shop two days
into its grace that moved its month two days later — and those two days, on
which it traded in full, were in no paid period. Every late month moved the
renewal date later for good: a shop that always paid on the last day of a
fourteen-day grace paid for eight months in twelve.

**Now** (`AssignPlanAction::window`):

| The shop is | The period it buys starts |
|---|---|
| on the same plan, still running | where the paid one ends (as before) |
| on the same plan, **in its grace days** | **where the paid one ended** — grace is full use |
| on the same plan, grace spent (read-only) | today — it could not use those days |
| moving to a different plan | today (as before; see "Not done") |
| any of them, with dates typed | the dates typed |

### 4. A month added to the 31st ran into the month after

`addMonths` rolls a date that does not exist forward. A shop put on a monthly
plan on 31 January was paid up to 3 March; on 31 August, to 1 October. Days
nobody was charged for, an anniversary that crept, and a date the bills meter
(which clamps — `PlanLimits::periodStart`) did not agree with.

**Now:** `addMonthsNoOverflow` — 31 Jan → 28 Feb, 29 Feb + a year → 28 Feb.
(The same slip, `subMonth`, put the platform dashboard's "a month ago" inside
the CURRENT month on the last days of a long one. Fixed the same way.)

### 5. The dialog explained the rule and left the admin to work out the dates

It said "stacks if still running" in a sentence. What was written was whatever
the server made of it, and every later renewal stacks onto that date.

**Now:** `GET /admin/tenants/{tenant}/plan-window` (the same `window()` the
save uses — one copy of the rule) and a line in the dialog, before anything is
saved: *"This buys 11 Nov 2026 → 11 Dec 2026. It carries on from 11 Nov 2026,
so no paid day is lost."* It says why in each of the six cases
(`admin/planWindowWords.ts`), turns red on dates typed the wrong way round,
and disables Assign. The dates boxes are cleared each time the dialog opens.

### 6. The shop was shown the plan's price as what it pays

Its own Subscription screen said "Rs 3,000 every month" to a shop asked for
Rs 3,400: the add-on was on the admin's page and nowhere a shop could see it.

**Now:** `/shop/subscription` carries `bill` (the same reckoning, without list
prices the shop was not given) and the screen lists each add-on with its cost
and **You pay every month — Rs 3,400** (`shop/whatYouPay.ts`).

### 7. Smaller things, found by using the screens

- On a phone the owner's Payments table showed date, plan and period — the
  **amount** was a sideways scroll away. Two-line rows now, amount first.
- "Days a till may sell offline" had no accessible name (its cell holds two
  controls, where the automatic label pairing stops). Tied by hand.
- A plan's price reopened as "3000.00". Shown as typed.
- Module descriptions said "a catalog of physical products". Reworded.

## What held, and is now written down

- The bill is the plan plus the add-ons **as the shop stands**; a yearly plan
  pays twelve months of each add-on; a shop's own add-on price overrides the
  list price and both are shown to the admin.
- A plan repriced moves the **next** bill and nothing already paid.
- Grace: full use, loud warning, counted in days on both sides. Read-only:
  every write refused with *"Your subscription has expired. Your data is safe
  — renew to continue making changes."*; every read works; a payment brings it
  back at once.
- Moving to a bigger plan lifts the ceiling immediately; to a smaller one
  keeps everything the shop has and refuses the next one over.
- Collected for a period == the ledger's total for the same dates, by the day
  the money arrived.
- Modules are the shop's: no plan change switched one off.

## Not done — and worth a decision

- **No pro-rating.** Moving plan mid-period starts a new period today and what
  was left of the old one is not carried over. The dialog now says so in
  words, and the amount is whatever the admin types.
- **"Bills a month" on a plan paid by the quarter or the year is counted over
  the whole period** (deliberate, and tested: `TheShopsOwnMonthTest`). A yearly
  plan with "5,000 bills a month" calls a shop over after 5,000 in the YEAR.
  It never stops a till. Either the window should be monthly or the figure
  should be multiplied by the months — the user's call.
- A shop given a free period reads **Paid** on the admin's list (it means "not
  behind"). There is no "complimentary" chip.
- After a lapse, `subscription_starts_at` restarts on the day of the late
  payment (the bills meter follows it, which is consistent). "Customer since"
  on the shop's page is its creation date and does not move.
