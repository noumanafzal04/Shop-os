# The paper reads the shop's clock

**2026-10-06 · found by the QA journey, stage G**

## What happened

A quotation written at 12:53 in the afternoon printed "Date 06 Oct 2026,
07:53 AM". The receipt beside it said 07:47 AM for a sale rung at 12:47.
Every printed document called `->format()` on a UTC timestamp where it stood.
The application's zone is UTC and stays UTC; a shop in Pakistan is +5.

After midnight it was the wrong **day**: a sale at 02:00 on the 7th printed
"06 Oct · 09:00 PM" — on the slip a customer brings back to return goods.

No test noticed. Every test that reads a receipt reads what is on it; none
read when.

## The rule

Anything a PERSON reads with a clock time in it goes through
`ShopTime::show($moment, $format, $tenant)`, which renders it in the tenant's
own `timezone` (Pakistan when unset, as the column defaults). Stored and sent
values stay UTC.

A **calendar date with no time** — a quotation's "valid until", a warranty's
last day — is not a moment and is not moved. Midnight UTC on the 13th is the
13th in Karachi and the 12th in New York; a date that changes with the reader
is no longer the date that was promised.

Used by: the receipt, the quotation/advance and its payments, the Z-read
(opened, closed, cover spans), the kitchen ticket, and the reservation
"pick it up before…" message. A view that formats a clock time on its own
fails `ThePaperReadsTheShopsClockTest`.

## NOT decided: when does a shop's day end?

Reports, the dashboard and the ledger cut days at midnight **UTC** — 5 AM in
Pakistan. So "today" runs 05:00 to 05:00. For a shop that closes at 2 AM that
is, by accident, what it wants: the night belongs to the day before. But:

- a receipt now says 07 Oct 01:00 AM for a sale the books file under 6 Oct;
- the month's first five hours are in the previous month;
- a zone that is not +5 gets a different, equally accidental, boundary.

This was left alone on purpose. It is a decision about a shop's books — the
recommendation is an explicit, shop-local "day ends at" (default midnight, or
whatever closing time the shop keeps) rather than a side effect of the
server's clock.

## Also on those papers

- The kitchen ticket never printed the shop's name: `$tenant->name` on a model
  whose column is `business_name`. A missing attribute is null and silent.
  The one test that opened the slip asserted only that it opened.
- A quotation for a phone number with no name printed "Customer  Customer ·
  0300…". `Customer::UNNAMED` / `knownName()` is the one rule for the
  placeholder; the sale had its own copy of it and the quotation had none.
