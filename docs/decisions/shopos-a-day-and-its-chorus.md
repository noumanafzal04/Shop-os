# One shop's day, and then every screen asked the same question

**2026-09-01** · backend + panel

## The problem this is a reaction to

The supplier `Pay` button settled nothing for weeks inside a green suite. The
reason was not a missing test: `CashMovementTest` had been posting to that
endpoint since August. The line was **covered**. What no test did was ask what
the balance said afterwards.

That is the shape of every miss this codebase has had:

| miss | what was covered | what was never asked |
|---|---|---|
| supplier Pay | the endpoint answered 201 | did the balance move |
| sized parent adjust | the endpoint answered 201 | did the shelf move |
| low stock | each screen answered | did the screens agree |
| sold-out / 86 | the till refused | did the other two doors refuse |
| discount ceiling | the till capped it | did the online door cap it |

So the answer is not a deeper test of each module. It is a whole DAY — bought,
sold, refunded, banked and closed off — with a **chorus** at the end: the
questions a shopkeeper actually asks at ten at night, put to every screen that
can answer them, with the answers required to match.

`tests/Feature/ADayInTheShopTest.php`.

## Two rules the chorus is built on

**The expectation is the test's own.** A chorus alone catches disagreement, not
a shared mistake — four screens reading one broken query agree perfectly. So
the day keeps its own books as it goes (every rupee into the drawer, every
rupee out) and the screens are measured against that, never only against each
other.

**Failures are collected, not thrown.** The interesting fact about a
disagreement is *which* screens disagree, and an `assertEquals` on the first
one ends the test there.

## What the first run found

### F1 — only the till ever told the drawer a sale had happened

One mart day, with a drawer open: three sales through `POST /sales`
(cash 1,000 · card 500 · khata 750), one bag refunded in cash, a khata payment
taken, the supplier paid, a wage bill paid.

| | said | should have said |
|---|---|---|
| the day, closed off | **0** | 2,250 |
| the drawer's expected cash | **100** | 850 |

`cash_session_id` is offered by four doors and filled by one:

| door | fills it |
|---|---|
| the till (`PosPage`) | yes |
| Sales → New Sale | no |
| the returns desk | no field at all |
| dine-in settle · quotation → invoice | passes through what it was given — nothing |

Money **leaving** the drawer had resolved itself server-side all along —
`RecordCashMovementAction`'s own docblock says "the session, lane and branch
are resolved SERVER-side from the caller". Money **arriving** did not. So the
afternoon's expenses came out of a drawer that had never heard about the
afternoon's takings, and `BusinessDay` — which sums the shifts — closed off
reading zero.

`SaleController` had already written the fault down in its own comment ("whose
cash belongs to no reconciliation and shows up in no shift report") and
answered it only for shops that switch on `pos_require_shift`, which ships
**off**.

**Fixed** by `BooksDrawer::tillFor()` — one rule, the mirror of the one that
already existed for money going out. Consulted by `CreateSaleAction`,
`ProcessSaleReturnAction` and the `SHIFT_REQUIRED` gate, so every door gets it
and the next door will too.

Two fences on it:

- a **practice** till answers null. A sale inherits `is_training` from the
  drawer it is rung on, so resolving a practice shift would silently turn a
  real customer's sale into a practice one — no stock moved, no revenue, gone
  from every report. `BooksDrawer::isPractice` already exists for exactly this
  reason on the expense side.
- the **sync** path is excluded. A synced sale happened hours ago and names its
  own shift; attaching it to whichever drawer is open when the tablet
  reconnects would file yesterday's takings into tonight's count.

### F2 — a refunded item took the whole ticket off the sales report

Same day. The 1,000 cash sale had one 250 bag returned, so it became
`partially_refunded`:

| surface | said | |
|---|---|---|
| cashbook · day · Z-read | 2,250 | counts the three live statuses |
| **sales report · dashboard** | **1,250** | drops the whole 1,000 ticket |

1,250 is neither the gross (2,250) nor the net (2,000). "Which sales count?"
was asked in **thirteen** places across `ReportService` and `DashboardService`
and answered `Completed` only, so revenue, the chart, top products, margins,
the staff report and the tax return all lost a ticket the moment any part of it
came back.

**Fixed** by `App\Support\Takings` — one copy of the rule, now also used by the
five places that already had it right (`cashbook`, `LedgerService`, the bank
claims report).

### F3 — F1 was wider than the front door

F1 was found through `POST /sales`. A `Sale` row is created by **six** paths,
though, so the same cash was put through each one with a drawer open and the
X-read a cashier would actually pull was read either side:

| door | drawer moved (before) | should |
|---|---|---|
| the counter | **0** | 400 |
| a quotation turned into an invoice | **0** | 300 |
| an exchange with a top-up | **0** | 100 |
| a dine-in tab, settled | **0** — and the day closed at zero | 1,800 |
| an online order completed | 0 | **0** |

The restaurant is the worst case. A food shop trades almost entirely off its
floor, so before the fix a restaurant's whole day closed off reading **zero**
while its cashier counted a drawer full of money the till had never heard of.

The last row is what keeps the rule honest, and it changed the fix. Resolving
the drawer for EVERY sale would have attached a completing online order — a
COD order becomes a `cash` tender — to whichever drawer happened to be open.
That is the same bug pointed the other way, and it is worse: the drawer then
expects money that never crossed it and the cashier counts **short**, which is
what people get accused over. So the resolution is fenced to counter channels,
the same line `SaleController` already draws for `pos_require_shift`.

Mutation-proven both ways: removing the resolution turns three doors to zero
and leaves the online one alone.

### F4 — the fence on F3 was itself half a rule

F3's fix fenced the drawer resolution to counter channels, reasoning that an
`online` sale had not crossed the till. Putting the last two doors through the
matrix showed the reasoning wrong in one direction.

`channel` says where the ORDER came from. It does not say where the MONEY was
taken, and the two part company at the door:

| door | channel | where the money was taken |
|---|---|---|
| a reserved item collected | `online` | **the counter** — `ReservationService::complete` is documented "customer arrived" |
| a pickup order collected | `online` | **the counter** |
| a delivery order | `online` | the rider |

A customer who reserved a Rs 5,000 item, walked in and paid cash would have left
the drawer short by the whole amount: the original bug, still live, inside the
fix for it.

`fulfillment_type` is the only field that knows the difference, so callers that
know now say so — `collected_at_the_counter` — and the channel-shaped guess is
used only when nobody does. Seven doors are in the matrix with both signs.

### The offline replay, which must reach none of them

The mirror of the whole rule. Resolving from "whoever is standing at the
counter" is right for a sale being rung and exactly wrong for one rung on
Tuesday that reached the server on Friday: the person who reconnects the tablet
is not the person who took the money. What that would look like is a cashier
opening up on Friday, a tablet finding wifi, and their drawer silently expecting
three days of somebody else's takings — a variance in the thousands, on their
shift, with nothing on the X-read to explain it.

### A coincidence, written down

`Takings::COUNTED` and the `status != cancelled` spelling used by the customer
card, the dispensing register, the waiter report and global search select the
same rows today — but only because `SaleStatus` has exactly four cases. That is
not a rule, it is arithmetic. `WhichSalesCountTest` pins it, and its failure
message SCANS for the other spelling rather than listing one that would be stale
within a week: it names four files and nine sites.

## What was NOT done, and why

The plan's C5 said "per-trade specials — batch, serial, job card, forecourt,
dine-in". Only dine-in was written. The rest already have owners:
`FuelManagementTest` alone covers the forecourt in thirty tests, including fuel
that crossed a meter and was never rung up. Writing a second, shallower version
beside it would have added a maintenance cost and no coverage.

What had no owner was the set of doors above — which is where the day flow's
own finding turned out to live.

## Gross, not net — and why

Revenue stays **gross**, with refunds as their own dated line.

A refund is dated by the day it was **handed back**. A bag returned on Thursday
against Monday's invoice cannot be netted off a Monday that has been closed,
counted and banked. Gross revenue plus a dated refund line is the only shape
where both days reconcile — which is why the cashbook was built that way, and
exactly what the P&L screens were missing.

So `summary()` and the dashboard gained a `refunds` figure; both profits
subtract it, and `cogs` has the returned goods' **snapshot** cost taken off
(today's cost would re-price a return from six weeks ago). The panel shows the
line only when the shop actually handed something back, next to the revenue it
reduces — without it, Revenue − Cost of Goods no longer equals Gross Profit and
the row reads like an arithmetic error.

## What this does not claim

Neither fix was caught by a scanner or by reading. Both were caught by running
a day and asking. The remaining questions in the chorus — what the shop is
owed, what it owes, what is on the shelf — and the other seven trades are
tracked in `docs/qa/TRADE-DAY-PLAN.md`.
