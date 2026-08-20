# The other half of a date

**2026-08-20.** Stock can be dated two ways in ShopOS, and until today only one
of them was ever read back.

| | **expires** | **ages** |
|---|---|---|
| the column | `expiry_date` | `manufactured_on` (from a tyre's DOT code) |
| the setting | `expiring_soon_days` | `stock_age_warn_years` / `stock_age_old_years` |
| shop-wide worklist | `GET /inventory/expiring` | **nothing** |
| dashboard | KPI tile · attention row · inventory tile | **nothing** |
| told at the counter | `near_expiry` on every scan | **nothing** |
| sold oldest-first | FEFO, `ORDER BY expiry_date` | **no order at all** |
| a morning alert | `NotifyExpiringStock`, per lot per stage | **nothing** |
| the scope that would do it | `expiringWithin` — two callers | `agedBeyond` — **zero** |

The right-hand column is not an oversight in one place. It is a whole half of a
feature that was designed, documented, given a setting an owner can change, and
then never wired to anything except a badge inside one product's batch drawer.

## The specification was in a comment

`App\Support\DotCode` states the requirement in its own docblock, and has since
the day it was written:

> a shop needs to see the age, **sell the oldest stock first**, and be warned
> before a customer notices

and again, on `status()`:

> `ageing` — **sell it BEFORE the newer stock**, and say so on the shelf

Neither happened. Depletion sorted on `expiry_date` alone:

```sql
ORDER BY expiry_date IS NULL, expiry_date
```

A tyre has no expiry, so **every lot in a tyre shop tied.** The database then
returned them in whatever order it liked — in practice the order they were
received — and the newest pallet went out of the door while the 2019 set aged
quietly behind it. The system knew which tyre was oldest and handed over a newer
one.

> **A requirement written in a comment is a requirement nobody implemented.**
> The comment is evidence that somebody knew — which is worse than not knowing,
> because it reads as done.

## Three fixes, one root

### 1 · The oldest lot leaves first

`ProductBatch::scopeOldestFirst()`, one implementation, three callers — the
batches relation, the FEFO depletion, and **the lot a return goes back into.**
That third one is why it is shared rather than fixed in place: a return that
lands in a different lot than the sale took it from leaves batch totals right
and the shelf wrong.

```sql
ORDER BY expiry_date IS NULL, expiry_date,
         manufactured_on IS NULL, manufactured_on
```

1. **dated lots before undated, soonest expiry first** — an expiry is a FENCE.
   Stock that becomes unsellable on a date outranks everything, because missing
   that date is a total loss.
2. **then lots with a manufacture date, oldest made first** — an age is a HINT.
   It breaks the tie expiry cannot see, which for a tyre shop is every tie there
   is.
3. **undated, unknown-age lots last** — "we do not know when this was made" must
   not read as "made today" and jump the queue, nor as "ancient" and be pushed
   out first.

Manufacture date is a **tie-break, never a promotion**: a medicine dying next
week still goes before an older-made lot with a year left on it.

### 2 · The counter is told

Settings → POS → Stock ageing had promised this in as many words:

> Nothing is blocked from sale; **the counter is told**, and the decision stays
> with whoever is standing there.

The second half was true and the first was not. `near_expiry` is permanently
null for a tyre, so the cashier heard nothing at all. `pos/lookup` now carries
`aged` beside it — the lot number, how old, and which side of the shop's own
threshold it falls on.

It names **the oldest** lot, deliberately, because that is now the lot the
customer will actually be handed. Naming the newest pallet while handing over
the 2019 set would be worse than silence.

Both notices are now branch-scoped through one shared query. A cashier in
Gulberg being warned about a lot on the Johar Town shelf is a warning about
stock they cannot see, while the lot they *can* see goes unmentioned.

### 3 · The shelf can be swept

`GET /inventory/ageing`, and an Ageing stock panel on Inventory beside the
expiry one. `agedBeyond` finally has a caller.

The badge in the batch drawer answered *how old is THIS lot*. Nothing answered
*which of my lots are old*, and a tyre shop carrying two hundred sizes was never
going to open two hundred drawers to find out.

**Deliberately a quieter colour than the expiry banner.** Expired stock is money
already lost and cannot be sold; an old tyre is saleable stock in the wrong
order. Painting them the same red teaches a shop to ignore both.

`?years=` asks a stricter question than the shop's own policy — a fleet contract
or an insurer — **without changing the shop's policy to ask it.**

## What was deliberately NOT built

- **No dashboard tile.** The expiry tile exists because an expiry is a deadline
  and missing it is a total loss. An age is not a deadline; the stock stays
  saleable and the number moves once a month. A tile that never changes is a
  tile nobody reads.
- **No morning alert.** [[shopos-expiry-alerts]]'s rule is that a lot speaks
  once per stage. A lot crosses "ageing" once in five years, so the alert would
  fire once and be forgotten by the time it mattered. The counter notice, at the
  moment the tyre is in somebody's hand, is the right place to say it.
- **Nothing offline.** The till sells an aged tyre with no notice, exactly as it
  sells a near-expiry item with none. The sale is correct either way; only the
  warning needs the server. Recorded in the Help Centre rather than hidden.

## Why the scanners did not find this

Two tools were pointed at this codebase yesterday and neither could have caught
it.

- **`dead-rules.py` found `agedBeyond`** and its own `SETTLED` entry recorded it
  as *"a GAP, not a defect: BatchController already publishes age and age_status
  per row, so a shop can see which lots are old — it just cannot ask for only
  those."* **That judgement was wrong**, and wrong in an instructive way: it
  measured the gap as a missing FILTER and missed that the same unread column
  meant the wrong tyre left the shelf. A dead scope is not only a missing
  feature — it is a question the code stopped asking.
- **A "settings nobody reads" scan was prototyped and thrown away.** All 58 keys
  in `ShopSettings::defaults()` have a real reader outside the form that writes
  them. `stock_age_warn_years` was read — once, for a badge. The shape here was
  never "a setting nobody reads"; it was **a setting read in one of the several
  places its own UI copy promised.** A scanner cannot read a promise written in
  prose, and a tool that reports 0 forever gives false comfort. Measured, and
  recorded as measured, rather than kept.

What DID find it: reading the two columns side by side and asking, for each row,
*does the other one have this?* Same technique as
[[shopos-ceiling-follows-the-bill]] and [[shopos-sold-out-three-paths]] — one
question, several paths, and only some of them answering. The third time in two
days.

## The tests, and the trap in them

`AutoWorkshopTest` gained 12. Four went red immediately; **two of the four
passed against the bug on the first attempt** and had to be rewritten:

- `test_the_oldest_first_rule_is_not_just_insertion_order` creates the old lot
  first, so the database's own order gives the right answer by luck. It passes
  either way. Its mirror — the fresh lot created first — is the one with teeth,
  and **both are kept** so neither direction can pass by accident.
- The first version of every lot helper wrote `branch_id` null. FEFO matches
  lots at **this** branch, so none of them were visible to the depletion under
  test and four tests failed for the wrong reason. Third time this repo has
  shipped that mistake — see [[shopos-forecourt-branch]] and
  [[shopos-adjust-wrong-branch]] — so the helper now carries a comment saying so.

Sweep **phase S** asks the same questions of every shop with the inventory
module, and is not gated on a trade: `dot_code` is accepted on any lot and
`/inventory/ageing` asks the shop rather than the trade, so a trade list in the
phase would be a second copy of an answer the product already has. 8 of 9 shops
covered; finance correctly skipped.

Five mutations (35–39) break it on purpose. The sharpest is not "no lot moved" —
that lie trips half the phase and proves little. It is
`_lots_answered_backwards`, which hands the sweep **the exact wrong answer**: the
old lot full and the new one empty, which is precisely what a shelf sorted on
expiry alone did to a tyre shop.

## Two harness fixes on the way past

- **`Report.expect` reads a list `want` as "any one of these will do".** Phase S
  passed it a list of expected ROWS, so it asked whether the whole list equalled
  one of its own members and **reported the exactly-right answer as something to
  look at** — 18 times. Orders are compared as a joined string now.
- **Phase C's drawer check assumed a 1,000 float and no prior takings.** True
  only on a virgin shop; this sweep reuses an open shift between runs on
  purpose, so on a re-run the check reported the shop's *correct* arithmetic as
  a query. It now measures the **delta** across the movements (+200 in, −150
  out, so +50), which is the actual claim and is true whatever the drawer
  already held. *A sweep that cries wolf teaches people to ignore it.*
- **Phase Q was guessing which product was fuel.** Found by the new phase, which
  is the useful part. `_a_fuel_product` searched for "Petrol" and took the first
  row, then fell back to the first product in the whole shop. Phase S's shelf
  item had the SKU `SWEEP-SHELF-PETROLEUM`, product search reads the SKU, and the
  rate check spent its run trying to reprice a tyre — the server saying `422 …
  isn't held in a tank` while the harness correctly reported `UNCLEAR: the check
  never ran`. A tank names its product; it asks `/fuel/tanks` now, and phase S's
  SKU no longer carries a trade name. *A check that guesses its subject is a
  check about whatever happens to be first* — right by luck for as long as
  nobody else added a product.
- **Phase S's own shelf reset could fail without saying so.** It zeroed each lot
  with a batch-scoped adjustment — **exempt from batch accounting by design** —
  and then deleted the row, which is **refused 422** on any lot still holding
  stock. The phase was green before and after the fix, because the lots each
  check cared about had usually been depleted by the check before; the fault is
  narrower and worse than a wrong answer. **The reset could fail and said
  nothing**, so every assertion after it was conditional on luck nobody was
  measuring. It disposes of the lot the way a shop does now, and files a QUERY
  when it cannot. *Setup is not exempt from the denominator rule just because it
  is not the thing being tested.*
- **`dead-rules.py` now fails on a stale `SETTLED` entry** rather than printing
  one and exiting 0. It had a live entry claiming `agedBeyond` was unwired hours
  after it was wired to two call sites. A stale exception is worse than no
  exception, because it is believed.

Related: [[shopos-sold-out-three-paths]], [[shopos-ceiling-follows-the-bill]],
[[shopos-expiry-alerts]], [[shopos-auto-depth]], [[shopos-forecourt-branch]],
[[shopos-detector-vs-rule]]
