---
name: shopos-two-doors-one-drug
description: "FIXED 2026-08-21: a schedule-controlled medicine went out of the PHONE-ORDER door with no prescription while the till refused the same product. Two fences, two columns. Product::booted() pairs them; OrderService asks the schedule too"
metadata:
  node_type: memory
  type: project
---

**2026-08-21.** Proven, not reasoned — one product, one shop, one shopkeeper:

```
drug_schedule='G'  requires_prescription=false
PHONE order  →  201  (ACCEPTED)
TILL  sale   →  422  PRESCRIPTION_REQUIRED
```

**Two fences reading two different columns.** Till asks `drug_schedule`; the
order path asked `requires_prescription`. On the product form those were
**free-standing fields with nothing tying them**, so a medicine could be
Schedule G with the prescription box unticked.

The till's own comment said the online case *"is the order, not the till"* —
right instinct, safe ONLY if the order path refused. It didn't.

> **A comment that assumes another path did the work is a dependency, and an
> unchecked dependency is a hope.** Third time this month
> ([[shopos-sold-out-three-paths]], [[shopos-ceiling-follows-the-bill]]).

**Cost:** a controlled drug dispensed with no prescriber recorded → **no line in
the dispensing register**, the list a regulator asks to see. The register was
never broken; this door told it nothing.

## Fix — root, then fence

- **`Product::booted()`** forces `requires_prescription = true` when
  `drug_schedule` is filled. **A controlled drug that needs no prescription is
  not a thing.** In the MODEL not the form: there are **four writers** (create
  action, update action, CSV import, seeders) and *a rule enforced in three of
  them is the bug this came from.* Migration backfills; **not reversible** —
  `down()` would have to guess which rows had the flag off on purpose, and the
  answer is none.
- **`OrderService::place`** asks `filled($product->drug_schedule)` too. The hook
  fires on `save()`, so raw queries / old imports slip past — the door must
  refuse a drifted row **by itself**.

## The mutation that PASSED is the lesson

Removing the order-door check left **every test green** — the model hook was
answering for it. The fence was real and **nothing pinned it**. Now
`test_the_order_door_refuses_a_drifted_row_on_its_own` writes the drifted state
past the model (`DB::table(...)->update`), **asserts the drift exists** (or the
test proves nothing), then orders.

> **A mutation that passes is not reassurance. It is the check telling you it is
> not there.**

Denominator kept: an ordinary paracetamol phone order still succeeds.

## The scanner said it was fine, in writing

`one-rule-many-paths.py` carried *"the order path has its own, stronger
RX_IN_PERSON_ONLY"* — **believed, and false**, written by reading two error
codes and inferring the rest.

> **An exception on a list of exceptions is a CLAIM. Check it; do not admire
> it.** (Same lesson `dead-rules.py` learned from the other direction.)

Related: [[shopos-pharmacy-edges]], [[shopos-sold-out-three-paths]],
[[shopos-detector-vs-rule]], [[shopos-other-half-of-a-date]]
