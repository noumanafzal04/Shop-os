# The QA sweep, and the harness that lied about it

**2026-08-18.** A standing sweep that drives the whole product from outside, one
shop per business type, and reports what it saw rather than passing or failing.

## Why it is not a test suite

`php artisan test` answers "does the code do what the code says". It cannot
answer "does a pharmacy that was created this morning have a shelf, a till and a
way to refund a customer" — because every fixture in it was built by the same
hands that built the feature. The sweep creates a tenant through the admin
console, logs in as its owner, and sells something. Nothing is stubbed.

Its report has **three** levels, and the middle one is the reason it exists:

| | |
|---|---|
| `BUG` | a defect, reproducible from the recorded call |
| `QUERY` | behaviour that differed from what the sweep expected — **about half turn out to be correct behaviour nobody wrote down**, and finding those is worth as much as finding a defect |
| `HARNESS` | the sweep itself being wrong, kept on the record because a harness bug that looks like a product bug is the most expensive kind |

**Thirty-seven harness findings, two product bugs**, so far. Every one of the
thirty-seven was reported as a defect on first read.

Both real defects are the same shape — **one question, answered differently by
two paths, with no error anywhere**:

- [The forecourt nobody could start](shopos-forecourt-branch.md): a tank stored
  `branch_id: null` while opening a shift resolved a missing branch to Main, so
  no station that used the shipped setup screen could ever run a shift.
- [The stock correction that landed at the wrong shop](shopos-adjust-wrong-branch.md):
  a hand adjustment always wrote to Main, whichever branch the owner was
  operating.

Each sat behind a thorough, well-named test suite that never asked the question —
`FuelManagementTest` because every fixture supplied the field the panel omits,
`BranchOperatingContextTest` because all four of its tests happened to be about
the sale path.

## The rate limits are the product working

Two of them bit, and both times the correct fix was in the sweep:

- **`throttle:auth`, 5/min per IP.** The sweep drives nine identities. It now
  caches tokens between runs and revalidates them with `/auth/me`, which is also
  what the panel does — so the sweep exercises the path that ships.
- **`throttle:api`, 240/min per user.** Five mutation passes back to back
  exceeded it. The client now waits out a 429 once, using the server's own
  `Retry-After`.

Loosening either would have been the wrong fix in a system whose worst failure
is a till that cannot take money.

## `mutate.py`, and the day it lied

A green sweep proves nothing on its own. "169 ok, 0 bugs" is indistinguishable
from "169 checks that cannot fail", and this repo has already shipped three
guards that passed while blind to their own subject. So `mutate.py` breaks the
sweep on purpose — freeze the stock reading, double the expected price, make
every refusal read as success — and requires the matching finding to appear.

**Then it did the exact thing it was built to catch.** Two mutations came back
`THE CHECK IS BLIND`. Both checks were fine. The phase had died on a 429 partway
through, so the check never ran, and the harness reported silence as blindness.

A detector with no denominator, inside the tool written to find detectors with
no denominators.

It now has three verdicts, and the third is the honest one:

| | |
|---|---|
| `CAUGHT` | the sweep reported the finding |
| `MISSED` | the check ran and said nothing — **a real hole** |
| `UNCLEAR` | the check never got to run — fix the run, not the code |

Two later mutations earned that third verdict again, and both were **bad
mutations rather than blind checks**: one froze a stock reading that the sweep's
own restock also depended on, so the phase rang into an empty shelf; another
patched a reader the check under test does not use, so the lie never arrived. A
mutation aimed at the wrong reader proves nothing while looking exactly like a
hole.

Every mutation must now name a `ran_marker`: a row that only appears if the
check executed. Absent that row, the verdict is `UNCLEAR`, never `MISSED`.

One of the five was also a **bad mutation** rather than a blind check: it
received goods at the price the product already carried, under which a blended
cost and an unchanged cost are the same number, so nothing could be detected. A
mutation that cannot fail is the same mistake as a check that cannot fail, one
level up.

## What the sweep has established

**Thirteen phases, 891 checks in one run, 15 of 15 mutations caught — and two real defects.**

- **Server-authoritative pricing holds.** A sale posted with `unit_price: 1`,
  `line_total: 2` and `tax: 999` against a product priced 500 is charged 1000,
  tax 0. The fields are dropped silently rather than refused — correct, because
  a shop on an old client should keep selling at the right price, not stop.
- **The shelf and the drawer agree.** sale −3, return +1, void +2; expected cash
  = float + net cash + paid-in − paid-out, to the paisa, on every trade.
- **A sale cannot be voided twice** (409). That is the double-restock bug class
  this codebase has been bitten by, closed.
- **Moving cost blends on receive**, weighted by quantity — not last-price, not
  unchanged, never blanked.
- **The movement ledger names its causes**: `sale`, `sale_return`,
  `sale_cancellation`, `purchase_order`, `stock_count`. `type` is only ever
  `in`/`out`/`set`; the cause is `reference_type`, and that split is what makes
  the table usable during a dispute — the only time it is read.
- **`business_category` is not only a label.** A food tenant created with
  `restaurant` gets the inventory module; a food tenant with no category does
  not. That is its one behavioural use out of seventeen, and it works.
- **Blind close is really blind**: `expected_cash` and `cash_sales` are *unset*
  from the X-read for anyone without `SUPERVISES_TILLS`.
- **The profit line is arithmetic**: `gross = revenue − cogs`, `net = gross +
  other_income − expenses`, checked against the report's own figures so it holds
  regardless of what the sweep did first. Recorded income missing from profit has
  shipped here once; it is the perfect silent bug.
- **The cashbook derives rather than duplicates**: `money_in − money_out = net`,
  and `sales_revenue` never exceeds `money_in`.
- **Khata end to end**: credit sale onto the balance, overpayment refused
  (`KHATA_OVERPAYMENT`), exact repayment clears it. The credit tender *covers*
  the bill — `amount_paid` is the full total, not zero — and a khata sale may
  never produce cash change, or a mistyped credit amount turns the till into a
  cash dispenser.

## `GET /shop/business-type` → 404 was correct

There is no such endpoint and none is needed. A trade's units and variant
attributes ride the public `/business-types` catalog, and the shop picks its own
row out of it — identical for every tenant of a trade, so a per-tenant endpoint
would be the same data behind a login and a cache nobody could share.

The lookup matches on **`business_type_primary`**, and that is load-bearing: the
catalog hides legacy codes, so a shop still carrying `restaurant` or `clinic`
finds no row at all if the raw code is used — no units, no variant attributes,
silently.

## The three phases that were added last, and why

A–H answer "does the shop work". They all came back green, and that was worth
less than it looked, because every one of them ran as the **owner** — who passes
every gate there is — on **one branch**, and never asked where the shop's money
goes when it is not a sale.

- **I · who is at the counter.** Each shipped job preset hired as a real staff
  member and asked from both ends: what its own description promises, and what
  belongs to somebody else. Plus three cashiers on three lanes at once, with
  deliberately different floats and basket counts — equal figures would let a
  drawer read its neighbour's takings and still balance.
- **J · the Expense Manager and the drawer.** A shop's money moves through the
  ledger *and* the physical till. An entry that lands in one and not the other
  is invisible until ten at night, when a cashier is short with nothing to point
  at. Also the opposite error: buying stock is COGS, and posting it as an
  operating expense too would make every margin wrong in the safe-looking
  direction.
- **K · more than one branch.** Everything that goes wrong here goes wrong
  because a quantity was read without asking where it was. This is where the
  second defect was found — Phase K set 60 at one branch and 25 at the other,
  then read back **25 and 0**.
- **L · the floor.** A restaurant's till is the last thing to hear what
  happened. Between the order and the money there is a tab that has to survive a
  table change, a split bill, and a waiter going home — and a kitchen that must
  see the dish and the note and **no prices at all**.
- **M · the money given away on purpose.** Points, coupons and promotions are
  one thing wearing three hats, failing the same two ways: given twice, or not
  given at all. Note the distinction the sweep had to learn here: `discount` is
  **not** like `unit_price`. A cashier keying "Rs 200 off" is a real thing shops
  do, so the field is accepted and fenced by `discounts.apply` instead — in both
  places, because the bug was that only the per-line half was fenced.

## Running it

```bash
cd shopos-backend && php artisan serve --port=8000
cd docs/qa/sweep
python3 run.py        # every phase, in order
python3 mutate.py     # prove the sweep can still fail
```

Both are re-runnable and must stay that way. The first version reported eight
bugs on its second run — "a business with this name already exists", the console
refusing duplicates correctly. **A sweep that can only run once is a sweep
nobody runs.**
