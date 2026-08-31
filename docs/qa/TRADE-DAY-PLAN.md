# One shop's day, per trade — the working ledger

> **This file is the resume point.** If a session ends mid-way, read the
> checklist at the bottom, find the first unticked box, and carry on from there.
> Every box is a self-contained commit.

## Why this exists

The supplier `Pay` button settled nothing for weeks inside a green suite. The
reason was not a missing test — `CashMovementTest` had been posting to that
endpoint since August. The reason was that **no test ever asked what the
balance did afterwards**. Coverage was there; the consequence was not asserted.

That is the shape of every miss this codebase has had:

| miss | what was covered | what was never asked |
|---|---|---|
| supplier Pay | the endpoint returned 201 | did the balance move |
| sized parent adjust | the endpoint returned 201 | did the shelf move |
| low stock | each screen answered | did the screens agree |
| 86 / sold-out | the till refused | did the other two doors refuse |
| discount ceiling | the till capped it | did the online door cap it |

So the strategy is not "more tests of each feature". It is **one day, run end to
end, per trade, where the last step is a chorus**: ask every surface that can
answer a question, and require the same number from all of them.

## The day

    shop created → catalog → supplier → PO → receive
      → day/shift open → sell (cash · card · khata) → return
      → khata repaid → supplier paid → expense
      → shift close → day close → THE CHORUS

## The chorus — one question, every surface

Each question is put to two or more surfaces that compute it *independently*.
Disagreement is the finding; the number itself is secondary.

| # | the question a shopkeeper asks | surfaces that must agree |
|---|---|---|
| Q1 | what did the shop take today? | day close · cashbook · sales report · dashboard |
| Q2 | what should be in the drawer? | Z-read · day close · session report |
| Q3 | what do we owe suppliers? | supplier card · dashboard · purchases report |
| Q4 | what do customers owe us? | customer statement · dashboard · khata report |
| Q5 | what is on the shelf? | product · inventory list · valuation report |

## The denominator

A day that quietly skips a module proves nothing about it. So the flow records
which modules it touched, and the test fails naming any module the trade has
**enabled** that the day never went near. Adding a module to a trade breaks this
test until the day covers it — that is the part that makes a future miss loud.

## Trades

food · mart · pharmacy · retail · services · automotive · petroleum · finance

Deep walkthroughs already exist for **mart**, **food**, **pharmacy** and
**finance** (books-only). They are not replaced — this runs *beside* them and
asks the cross-module question none of them asks.

---

## Checklist

- [x] **C1** — `ShopDay` helper + the spine + Q1/Q2, mart only, green
- [x] **C2** — all 8 trades through the spine — 7 that sell run the day; finance
      is asserted from the opposite end (no till, no day, books still kept), so
      the provider cannot quietly shrink to seven rows
- [x] **C3** — Q3/Q4/Q5 added to the chorus
- [x] **C4** — the module denominator ratchet: every module a trade ships with
      is either walked or excused **in writing**. Adding a module to a trade
      turns this red until somebody decides. Mutation-proven (dropping
      `expenses` from the walked list names 17 trades).
- [x] **C5** — the OTHER DOORS. Not per-trade specials in the end: the trade
      suites already own those (`FuelManagementTest` alone covers the forecourt
      in thirty tests). What nothing owned was the other ways a `Sale` row comes
      into being — see F3 below.
- [x] **C6** — fixed inline as each was proven: F1 (the drawer), F2 (the
      vanishing ticket), F3 (the other doors). Nothing is carried as a known
      bug.
- [x] **C7** — `docs/decisions/shopos-a-day-and-its-chorus.md`, HANDOVER ×2,
      memory `shopos-day-and-chorus`, Help Centre (POS · Day · Reports).

### Still open

- [ ] **C8** — the two doors the matrix has not put through the drawer:
      a reservation honoured (`ReservationService`) and an offline sale
      replayed (`PosSyncController`). Both build a sale row; neither has been
      asked what it does to the drawer.
- [ ] **C9** — `customers/index` spells "which sales count" a fourth way
      (`status != cancelled`). It agrees with `Takings::COUNTED` today by
      accident, not by construction.

## Where the day stands

| | |
|---|---|
| trades running the full day | 7 (food · mart · pharmacy · retail · services · automotive · petroleum) |
| finance | asserted from the opposite end — no till, no day, cashbook still kept |
| chorus questions | 5 — takings · refunds · drawer · khata · shelf · payables |
| sale doors put through the drawer | 5 (counter · quote→invoice · exchange · dine-in tab · order) |
| mutation-proven | Q1 (Takings), Q3 (supplier card), Q5 (valuation units), C4 (module ratchet) |

Q4 was rewritten after it was found to be weak: the customer card, the customer
list and the dashboard all read the SAME `credit_balance` column, so they could
not disagree. It now asks the column, the statement's newest running balance,
and the statement RE-ADDED from nothing.

## Findings

_(appended as they are proven — never as they are suspected)_

### F1 — only the till ever told the drawer a sale had happened  ·  FIXED

**Measured.** One mart day: 40 bags bought in, three sales rung through
`POST /sales` (cash 1,000 · card 500 · khata 750), one bag refunded in cash,
a khata payment taken, the supplier paid and a wage bill paid — all with a
drawer open.

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
| dine-in settle · quotation → invoice | passes through whatever it was given — nothing |

Money *leaving* the drawer has resolved itself server-side all along
(`RecordCashMovementAction`: "the session, lane and branch are resolved
SERVER-side from the caller"). Money *arriving* did not. So the afternoon's
expenses came out of a drawer that had never heard about the afternoon's
takings, and `BusinessDay` — which sums the shifts — closed off at zero.

`SaleController` had already written the fault down in its own comment
("whose cash belongs to no reconciliation and shows up in no shift report")
and answered it only for shops that switch on `pos_require_shift`, which
ships **off**.

**Fix:** `BooksDrawer::tillFor()` — one rule, the mirror of the one that
already existed for money going out. A practice till answers null, or a real
sale would silently become a practice one.

### F3 — three of the four doors that ring a sale never moved the drawer  ·  FIXED

F1 was found through the front door. This is how wide it actually was.

A `Sale` row is created by six different paths, not one. Put the same cash
through each with a drawer open, and read the X-read a cashier would pull:

| door | drawer moved (before) | should |
|---|---|---|
| the counter | **0** | 400 |
| a quotation turned into an invoice | **0** | 300 |
| an exchange with a top-up | **0** | 100 |
| a dine-in tab, settled | **0** — day closed at zero too | 1,800 |
| an online order completed | 0 | **0** |

The restaurant case is the worst of them: a food shop trades almost entirely
off its floor, so before the fix a restaurant's whole day closed off reading
**zero** while its cashier counted a drawer full of money the till had never
heard of.

The last row is the one that keeps the rule honest. An online order completing
is not a sale rung at a till — the rider is still out with the goods, or the
card was taken on the website — so the resolution is fenced to counter
channels. A drawer that expects money which never crossed it is the same bug
pointed the other way, and it is worse: the cashier counts SHORT, and short is
what people get accused over.

Mutation-proven: removing the resolution turns three doors to 0 and leaves the
online one alone.

### F2 — a refunded item takes the whole ticket off the sales report  ·  FIXED

**Measured**, same day. The cash sale of 1,000 had one 250 bag returned, so
its status became `partially_refunded`:

| surface | said | |
|---|---|---|
| cashbook · day · Z-read | 2,250 | counts the three live statuses |
| **sales report · dashboard** | **1,250** | drops the whole 1,000 ticket |

1,250 is neither gross (2,250) nor net (2,000). "Which sales count?" is asked
in **13 places** across `ReportService` and `DashboardService` and answered
`Completed` only — revenue, the chart, top products, margins, the staff
report and the tax report all lose a ticket the moment any part of it comes
back. Five other places (`DrawerMath`, `LedgerService`, `StockReportService`,
`PosController`) already use the wider set.

**Fix:** `App\Support\Takings` — one copy of the rule. Revenue stays GROSS
with refunds as their own dated line (a return on Thursday against Monday's
invoice cannot rewrite a Monday that has been closed and banked), so
`summary()` and the dashboard gained a `refunds` figure, both profits subtract
it, and `cogs` loses the returned goods' snapshot cost. Panel shows the line
only when there is one.

Gates after both: backend **2391 passed, exit 0** · panel tsc 0 · eslint 0 ·
vitest 1334 · build 0.
