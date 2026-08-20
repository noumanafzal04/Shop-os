---
name: shopos-other-half-of-a-date
description: "FIXED 2026-08-20: a tyre shop sold its NEWEST stock first — FEFO sorted on expiry alone and a tyre has none, so every lot tied. manufactured_on was written and never read: no order, no counter notice, no sweep. DotCode's own docblock had stated the rule"
metadata:
  node_type: memory
  type: project
---

**2026-08-20.** Stock is dated two ways here and only one was ever read back.

| | expires | ages |
|---|---|---|
| column | `expiry_date` | `manufactured_on` (tyre DOT code) |
| shop-wide list | `/inventory/expiring` | **nothing** |
| counter told | `near_expiry` every scan | **nothing** |
| oldest-first | FEFO `ORDER BY expiry_date` | **no order at all** |
| the scope | `expiringWithin`, 2 callers | `agedBeyond`, **0** |

`ORDER BY expiry_date IS NULL, expiry_date` — a tyre has no expiry, so **every
lot tied** and the database returned them in receive order. The newest pallet
went out while the 2019 set aged behind it. **The system knew which tyre was
oldest and handed over a newer one.**

`App\Support\DotCode`'s own docblock had said it all along: *"a shop needs to see
the age, **sell the oldest stock first**, and be warned before a customer
notices."*

> **A requirement written in a comment is a requirement nobody implemented.** The
> comment is evidence somebody knew — worse than not knowing, because it reads as
> done.

## The fix, three parts

1. **`ProductBatch::scopeOldestFirst()`** — `expiry_date IS NULL, expiry_date,
   manufactured_on IS NULL, manufactured_on`. Expiry is a FENCE and outranks;
   manufacture is a HINT and only breaks the tie (which for a tyre shop is every
   tie there is); undated sorts LAST — *"we don't know" is not "it's new"*. Three
   callers, and the third is why it is shared: **the lot a RETURN goes back into
   must be the lot the sale took it from.**
2. **`pos/lookup` carries `aged`** beside `near_expiry`. Settings → Stock ageing
   promised *"the counter is told"* and `near_expiry` is permanently null for a
   tyre. Names the OLDEST lot — the one now actually handed over. Both notices
   branch-scoped through one shared query.
3. **`GET /inventory/ageing`** + Inventory panel. The badge answered *how old is
   THIS lot*; nothing answered *which of mine are old*. Quieter colour than the
   expiry banner **on purpose** — same red teaches a shop to ignore both.

**NOT built, deliberately:** no dashboard tile (an age is not a deadline; a
figure that moves once a month is a tile nobody reads), no morning alert (a lot
crosses "ageing" once in five years — see [[shopos-expiry-alerts]]), nothing
offline (the sale is correct without the warning; Help Centre says so).

## Why yesterday's scanners missed it

`dead-rules.py` **did** surface `agedBeyond` and its own `SETTLED` entry called
it *"a GAP, not a defect"* — **wrong, and instructively**: it measured a missing
FILTER and missed that the same unread column meant the wrong tyre left the
shelf. *A dead scope is not only a missing feature — it is a question the code
stopped asking.* It now **fails** on a stale `SETTLED` entry instead of printing
one and exiting 0.

A **"settings nobody reads"** scan was prototyped and **thrown away**: all 58
keys in `ShopSettings::defaults()` have a real reader. `stock_age_warn_years` WAS
read — once, for a badge. The shape was **a setting read in one of the several
places its own UI copy promised**, and no scanner reads prose. A tool that says
zero forever is false comfort. (Measured and recorded as measured.)

## Two of my own tests passed against the bug

- The insertion-order test creates the old lot **first**, so the database gives
  the right answer by luck. Its mirror (fresh lot first) is the one with teeth.
  **Both kept**, so neither direction passes by accident.
- Every test lot helper wrote `branch_id` **null**. FEFO matches lots at THIS
  branch, so none were visible to the depletion under test. **Third time** — see
  [[shopos-forecourt-branch]], [[shopos-adjust-wrong-branch]].

## Sweep phase S + two harness lessons

Phase S "the shelf that ages", gated on `features.inventory` **not a trade list**
(a trade list is a second copy of an answer the product has). 8/9 shops. Five
mutations; the sharpest hands the sweep **the exact wrong answer** (old lot full,
new one empty) rather than no answer.

- **`Report.expect` reads a list `want` as ALTERNATIVES**, not a sequence — it
  reported the exactly-right answer as a QUERY 18 times. Join an order into a
  string.
- **A claim whose failure is a defect must `rep.bug`, not `rep.expect`** —
  `expect` files a QUERY and is therefore **invisible to `mutate.py`**, which
  looks for BUG rows. A claim that can only emit a QUERY cannot be proven to have
  teeth.
- **Phase Q was GUESSING which product was fuel** — search "Petrol", else the
  first product in the shop. Phase S's SKU `SWEEP-SHELF-PETROLEUM` matched it
  (search reads the SKU) and sorted newest-first, so the rate check tried to
  reprice a tyre. Asks `/fuel/tanks` now — **a tank names its product**. *A check
  that guesses its subject is a check about whatever happens to be first.*
- **Phase S's own shelf reset could fail silently.** It zeroed lots with a
  batch-scoped adjustment (**exempt from batch accounting by design**) then
  deleted them (**422** on any lot with stock). Green before and after — the
  lots usually happened to be empty — so the fault is not a wrong answer but
  that **the reset could fail and said nothing**. Disposes properly now and
  files a QUERY when it can't. *Setup is not exempt from the denominator rule
  just because it is not the thing being tested.*
- **Phase C's drawer check assumed a 1,000 float and no prior takings.** A re-run
  called the shop's *correct* arithmetic a query. It measures the **delta** now
  (+200 −150 = +50). *A sweep that cries wolf teaches people to ignore it.*

Related: [[shopos-sold-out-three-paths]], [[shopos-ceiling-follows-the-bill]],
[[shopos-auto-depth]], [[shopos-expiry-alerts]], [[shopos-detector-vs-rule]],
[[shopos-qa-sweep]]
