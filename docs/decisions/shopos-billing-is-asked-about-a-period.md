# Billing is asked about a period

**2026-10-10 · asked by the owner, looking at the screen: "Billing and payment screen main date picker hona chahye?"**

## What was there

A date control did exist — at the foot of the page, on the ledger, labelled
"Any date". Everything above it was fixed: a Revenue card reading *this
month / this year / all time*, the twelve-month trend, Money late, Chase
today. The top of the billing screen could not be asked what came in last
month, and the one control that could answer was four cards down and only
changed the table beside it.

The dashboards had been given a period the day before. Billing had not.

## What it is now

One period at the head of the page — the same `PeriodBar`, the same
`?from=…&to=…` in the address, the same `DashboardPeriod` on the server, so
the same like-for-like comparison (the first ten days of October against the
first ten of September; a whole month against the whole month before; a
period still running against the same *part* of the one before).

It opens on **this month so far**. A dashboard opens on the last seven days;
what is paid by the month is read by the month, and it is the figure this
screen had always led with — so nothing an admin sees on opening it changed.

Flows follow the period; states do not. That is the dashboards' rule and it
is this screen's:

| Follows the period | Does not |
|---|---|
| Collected | Money late |
| Payments | Chase today |
| Shops that paid (a shop paying twice is one) | Subscription health |
| The ledger, by default | Revenue to date (this year, all time), the 12-month trend |

"Money late last month" is not a thing — it is what is late now.

`GET /admin/billing/summary?from&to` → `period` (as the dashboards' is) and
`in_period: {collected, payments, shops}`, each `{value, previous,
delta_pct}` from `DashboardService::kpi()` — made public rather than copied,
so two screens cannot round a change differently. `revenue.this_month` is
still sent: the backend is deployed first, and the screen already in
browsers leads with it.

## One number, twice

The period's ends are cut exactly as the ledger's date filter cuts them, so
Collected and the ledger's own total for the same two dates are one number —
on one screen, a scroll apart. `BillingIsAskedAboutAPeriodTest` holds the
two endpoints to each other across a month boundary, and the browser test
reads both off the page.

## The ledger follows — until it is given dates of its own

Two date controls on one screen is how a screen comes to disagree with
itself: "I picked last month — why is the ledger showing October?" So the
ledger shows the period's payments and says so under its heading.

But a ledger is also an archive. "What did this shop ever pay", "whose is
this reference" — an archive that can only be read a period at a time hides
the row being looked for, and a search that finds nothing under a period
reads as *this shop never paid*. So:

- the ledger can be given its own dates, or none (its date control; the
  cross on the *Paid* chip; Clear all) — and that does **not** move the
  period at the top;
- an empty result under dates says *"No payment in Last month matches — it
  may be on another date"* and offers **Search every date**;
- choosing a new period at the top puts the ledger back on it. A new period
  is a new question.

`own === null` is "following"; a range with both ends null is "every date,
chosen". They are different states, which is why it is not a boolean
(`admin/ledgerWords.ts`).

The period itself is never "all time" — that is a report, and it is what the
ledger's own control is for.

## What moved

The Revenue card lost its "this month" headline and became *Revenue to
date*: the month so far is what the period opens on, and a second copy of it
there would have been the one figure on the screen that did not move when
the period did.

`datesAreThePlatforms.test.ts` now counts `<PeriodBar>` as a date control
too, and accepts a page's own `today` only when its declaration is the
server's date with `platformToday()` as the stand-in — never `new Date()`.

No migration.
