# Four doors

*2026-10-02 — "sth frontend UI py b dekhna… jaise supplier ko dekhna, add krna, remove krna — is trhan ki cheezain majood hai na"*

The question was the plainest one anybody has asked about this product: on the
screen that manages a thing, can a person **see** the things, **add** one,
**change** one and **remove** one?

It is also the question this codebase has got wrong eight separate times,
always in the same shape — *the API has the door, the screen never knocks on
it*. The odometer field, the second tender at settle, the settle refusal nobody
printed, the module switch-off warning, `offline_days`, `offline_selling`: none
of those were missing features. Each was a working endpoint with no control in
front of it.

---

## The instrument that could not work, and why it was deleted

The obvious tool is a script: parse `route:list`, parse the panel for
`apiPost` / `apiPut` / `apiDelete`, diff the verbs per resource. One was
written (`backend/scripts/crud-doors.py`). It reported **two** walled-up doors,
which felt like good news.

It was blind. A tidy hook says:

```ts
export function useStaffModule(basePath: string)
  …
  apiPut(`${basePath}/${id}`, payload)
```

No text matcher can say what `basePath` is — it is a **parameter**, and the
same hook serves the shop's staff list and the admin console's. Teaching the
scanner to resolve file-local `const` declarations did not help: the real cases
are parameters and bare identifiers, which is dataflow, not grep.

So "two findings" was a number measured against almost nothing — the
denominator problem, in a script whose whole purpose was to count. It was
**deleted rather than kept and distrusted**, because a reassuring detector is
worse than no detector.

A browser cannot be fooled that way. It sees the control or there is no
control. `panel/e2e/four-doors.spec.ts`, one project, nineteen screens.

## What the first run actually found

| | |
|---|---|
| Screens asked | 19 |
| Product defects | **2** |
| Defects in the spec itself | **3** |

All three of the first run's "failures" were the spec being too narrow, and
they are worth naming because the correction is the interesting part:

- **stocktake** offers *"+ Start a count"*. A shop **starts** a count; it does
  not "add" one.
- **categories** offers *"Rename"*. "Edit a category" means nothing.
- **tills** failed with *"rendered no controls at all"* — because the spec
  invented the path `/tenant/registers`. Registers have no screen of their own;
  `RegistersPanel` is mounted inside Shop Settings. **A path a test invents is
  a finding about the test.**

The vocabulary is wide now, and the guard against widening it until everything
passes is what goes *in*: every word is a verb that **makes** something — add,
start, raise, write off. "Export", "print", "filter" and "settle" are all
controls on these screens and none of them belong.

An empty list cannot be asked about Edit or Remove — those live on a row. That
case is counted as UNJUDGED and asserted at the end, because an UNJUDGED line
printed to a console and never counted is a check that deleted itself quietly.

---

## 1. A rider carrying the shop's cash could be removed

`cash_in_hand` on the riders screen is **delivered, paid in cash, not yet
handed back** — the shop's takings, in somebody's pocket. Beside it is Settle.

`DELETE /riders/{id}` was a plain soft delete. The row left the list and the
money left with it: `index` reads live riders, the statement reads a live
rider, settle posts to a live rider. Every door to that figure shut at once.
Nothing is lost in the database — the orders keep their `rider_id` — but there
is no way back to it from the panel, and nothing warned on the way out.

```
owner deletes a rider holding 2,100  →  200 "Rider removed"
```

Now:

```
422  RIDER_HOLDS_CASH
"Bilal Khan is still holding 2,100.00 in cash. Settle it first —
 removing them now would take it off this screen."
```

### Why the wrong row got pressed at all

The riders screen offered **Settle cash**, **Deactivate** and **Remove** — and
no way to change a name or a number. `PATCH /riders/{id}` has accepted `name`
and `phone` since the module was written; the screen sent `is_active` and
nothing else. So a shop that typed "Blial", or kept an old SIM, had exactly one
way to fix it: **remove the rider and add them again**.

That is the ninth instance of the shape, and it is the *cause* of the money
bug, not a separate one. A refusal with no way to do the thing the shop
actually wanted is a dead end, so the Edit control is the other half of the
fix. The phone here is the number the shop rings when a delivery goes wrong.

`backend/tests/Feature/TheRiderIsHoldingTheCashTest.php` — 5 cases, two of them
denominators (a rider holding nothing goes; a settled rider goes), because a
delete that refuses everybody would be a worse bug than the one it replaced.

## 2. A shop that does not use batches could not value its losses

The Disposals module is **on by default for a mart**. Its own words:

> Stock that left without being sold — binned, or sent back for credit.

The only writer of a `stock_disposals` row was `DisposeBatchAction`, reached
only by `DELETE /batches/{batch}`. A mart, a clothing shop, a hardware store or
a tyre shop keeps most of its stock in no batch at all, so the register was
permanently empty for them.

They were never unable to take the stock off the shelf — Inventory → Adjust →
out, reason "Damaged" has always worked. The gap is money:

| table | has a cost column |
|---|---|
| `stock_disposals` | `unit_cost`, `total_cost`, plus `credit_expected` from the supplier |
| `stock_movements` | **none** |

So three broken cartons came off the shelf correctly and the year's shrinkage
could not be totalled from anything the product stored. "Am I over-ordering?"
had no answer outside a pharmacy.

`WriteOffStockAction` + `POST /inventory/disposals` + a **Write off stock**
control on the screen that already promised it. The cost comes from
`products.cost`, which is the blended moving average maintained on every
receipt — what the shop actually paid for the units on the shelf now. A
variant's own cost wins where it has one.

**Unknown stays NULL, never zero.** Zero is a claim that the carton was free,
and a shrinkage total built on it reads as a smaller loss than the shop took.

### Why a lot-tracked item is refused here

A disposal row carries **one** batch number and **one** expiry. Writing off six
strips of a medicine held in four lots would have to pick a lot or invent one,
and the figure a pharmacist needs — *which lot went in the bin* — would be
wrong with nothing downstream able to tell. The refusal names the lot path.

`backend/tests/Feature/WhatTheBrokenCartonCostTest.php` — 9 cases. Two
mutations were run against them and both were caught: removing the lot guard
(8/9), and letting an unknown cost become zero (8/9).

---

## The new seeder phases, and the audit beside them

`loadtest:shops` built suppliers, purchases, sales and the expense book. It
built **no** customers, no khata, no returns, no count, no transfer, no
write-off, no coupon and no points — so every one of those modules had screens
measured against zero rows.

Added: 240 customers per shop (a third with a credit limit), one sale in six on
the book, part-paid; khata repayments; returns on one sale in twelve, half of
them partial; a stock count of 400 lines with a realistic share of shrinkage;
branch transfers; 30 write-offs; six coupons including an expired one and an
exhausted one; three promotions; loyalty switched on.

A coupon below its minimum spend **throws**, so attaching a code to one basket
in five refused one basket in five outright. At the counter the cashier takes
the code off and takes the money — so the seeder retries without it, which is
also the only way the refusal gets exercised at volume.

`loadtest:audit` is the other half and the point of all of it: for every figure
the product states, compute the same figure from the raw rows **by a different
route**, and say so when they disagree. Both faults that have cost a shopkeeper
money were arithmetic, not volume, and neither would have been caught by a
bigger catalogue.
