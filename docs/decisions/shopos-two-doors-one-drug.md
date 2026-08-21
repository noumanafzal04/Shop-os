# Two doors, one drug

**2026-08-21.** A schedule-controlled medicine could leave a pharmacy through
the telephone-order door with no prescription recorded, while the counter three
feet away refused the very same product.

Proven, not reasoned. One product, one shop, one shopkeeper:

```
  drug_schedule='G'  requires_prescription=false
  PHONE order  →  201  (ACCEPTED)          ← no prescription, no refusal
  TILL  sale   →  422  PRESCRIPTION_REQUIRED
```

## Two fences, two fields

| path | what it asks |
|---|---|
| the till — `CreateSaleAction` | `drug_schedule` filled? then `prescription_number` **and** `prescriber_name` are required |
| an order — `OrderService::place` | `requires_prescription` true? then `RX_IN_PERSON_ONLY` |

Two rules about the same thing, reading two different columns. And on the
product form those columns were **free-standing fields with nothing tying them
together**, so a medicine could be marked Schedule G with the prescription box
left unticked — and then each fence gave a different answer about it.

The till's own check even carries a comment saying the online case *"is the
order, not the till"*. Right instinct, and safe **only if the order path
refused**. It didn't.

> **A comment that assumes another path did the work is a dependency, and an
> unchecked dependency is a hope.** The same sentence closed the sold-out bug
> five days ago. This is the third time this month.

## What it cost

A shopkeeper writing down a telephone order dispensed a controlled drug with:

- no prescription number and no prescriber recorded;
- consequently **no line in `PharmacyController::dispensing`** — the register a
  regulator asks to see, which lists what was dispensed against which script.

The register was not broken. It was complete about everything it was told, and
this door told it nothing.

## The fix, in two places, and only one of them is the fence

### The root — `Product::booted()`

```php
static::saving(function (self $product): void {
    if (filled($product->drug_schedule)) {
        $product->requires_prescription = true;
    }
});
```

**A controlled drug that needs no prescription is not a thing.** The model will
not hold that state.

In the MODEL rather than the form, because there are four writers — the create
action, the update action, the CSV importer and the seeders — and *a rule
enforced in three of them is the bug this one came from.*

A migration backfills the rows written before the hook existed. Deliberately not
reversible: `down()` would have to guess which rows had the flag off on purpose,
and the answer is none of them.

### The fence — `OrderService::place`

```php
if ($product->requires_prescription || filled($product->drug_schedule)) {
```

Belt and braces, and it earns its place: the model hook fires on `save()`, so a
raw query, an old import or the very rows this migration had to clean would slip
past it. The order door must be able to refuse a drifted row **by itself**.

## The mutation that passed, and what it told me

Removing the schedule check from `OrderService` left **every test green** —
because the model hook was answering for it. The fence was real and *nothing
pinned it*.

`test_the_order_door_refuses_a_drifted_row_on_its_own` writes the drifted state
past the model with `DB::table(...)->update(...)`, asserts the drift actually
exists (or the test proves nothing), and then orders. Both halves now go red
under their own mutation:

| mutation | goes red |
|---|---|
| order door stops asking about schedules | `test_the_order_door_refuses_a_drifted_row_on_its_own` |
| model stops pairing the two fields | `test_a_controlled_drug_is_prescription_only_however_it_was_marked` |

> **A mutation that passes is not reassurance. It is the check telling you it
> is not there.**

And a denominator: `test_an_ordinary_medicine_still_goes_out_of_that_door`. A
chemist takes telephone orders for paracetamol all day and must go on doing so —
a fence that refuses everything proves nothing about the one thing it was built
for.

## The scanner said this was fine, in writing

`scripts/one-rule-many-paths.py` lists rules only one selling path asks, and
every difference carries a line saying why. `PRESCRIPTION_REQUIRED` carried:

> *"the order path has its own, stronger RX_IN_PERSON_ONLY"*

**That line was believed, and it was false.** The order path had a fence with a
similar name reading a different column. The entry was written by somebody
reading two error codes and inferring the rest.

> **An exception on a list of exceptions is a claim. Check it; do not admire
> it.** A stale exception is worse than none, because it is believed — the same
> lesson `dead-rules.py` learned yesterday, arriving from the other direction.

Corrected to say what is now true.

Related: [[shopos-sold-out-three-paths]], [[shopos-ceiling-follows-the-bill]],
[[shopos-other-half-of-a-date]], [[shopos-pharmacy-edges]],
[[shopos-detector-vs-rule]]
