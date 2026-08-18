# The refusal nobody read, and the rule that found it

**2026-08-18.** The panel got a reachability rule the day before. This is the
server's half, and it found something on its first run.

## What was wrong

`OfflinePolicy` has five offline rules. Four are about the SALE — the tender,
a dine-in table, redeemed points, a coupon — and one is about the ITEM: a
medicine, or anything tracked by serial number.

`PosSyncController` enforced four of them.

```php
$violations = OfflinePolicy::violations($sale);   // never looked at the items
```

`refusalFor()` — the sentence explaining why that item could not be sold with
no line — was written, tested, and **called by nothing**. So a sale carrying a
medicine arrived, applied, and was written down as a clean offline sale.
`offline_violations` null. Nothing in Reports → Offline. Nobody ever looking.

Proven before it was fixed, with a throwaway test against the real endpoint:

```
"status": "applied",
"violations": []
```

## Why it mattered more than the other four

The till refuses all five at the counter, and that refusal is good. But
`OfflinePolicy`'s own docblock says exactly why the server checks again:

> *"That refusal is a user interface, not a boundary: the outbox is a JSON
> queue in a browser database on a tablet that may have left the shop."*

The layer that exists for the case where the till is wrong had a hole exactly
the shape of the item rule — and of the five, that one has the worst ending.
The other four cost a shop money or an argument. These two are **a regulatory
event** (a medicine leaving with no batch recorded against it, possibly
expired) and **one handset sold twice** (two tills, one IMEI, two receipts).

## The shape of the fix

**Flagged, never refused.** The sale still applies. The money crossed the
counter and the box left the shop; refusing would delete the record of both.
That is the endpoint's existing rule and this changes nothing about it.

**The reason names the item.** The cashier's version does not need to — they
have it in their hand. The owner reading a report a week later has fifty sales
and no idea which box went out, so the report says `Augmentin 625: Medicines
need the live batch and expiry list…`.

**Deduplicated per product.** The same medicine on two lines of one bill is
one thing to tell the owner. A report that says the same sentence twice trains
the person reading it to skim.

**Resolved once per request, not once per sale.** A tablet dark for a week
arrives with a batch, and "is this a medicine" does not change between its
sales. `violations()` stays pure and takes the map as a parameter; the
controller does the one query. Pinned by a test that counts the query — move
the lookup into the per-sale loop and it reads 12 instead of 1.

## The rule that found it

`tests/Unit/ReachableTest.php`, the same sentence as the panel's:

> **A public method whose only callers live in `tests/`.**
> Tests prove a thing works. They do not prove anybody can get to it.

### Its own first version was wrong

It reported **nineteen** findings. Fourteen were noise, from one line:

```php
// stripped strings along with comments
T_COMMENT, T_DOC_COMMENT, T_CONSTANT_ENCAPSED_STRING, …
```

**In Laravel a route names its method as a string** —
`[PurchaseOrderController::class, 'receive']`. Stripping strings deletes
exactly the wiring the rule is looking for. Comments come out; strings stay in.
Nineteen became six, and five of those six were genuine test introspection.

*An audit that produces findings is a thing to verify, not to believe* — the
third time that sentence has earned its place, after the panel's stateful
`/g` regex and its comment-counting.

### What it cannot see, written down

Both found by mutating something and watching it stay green:

- **Private methods are not checked.** A private helper nobody calls is dead
  code — a different problem, different tools.
- **A method whose name is a common word self-exempts**, because "used inside
  its own file" is counted by name. `for`, `all`, `get` each match something in
  their own file and pass. Narrow names are checked; broad ones are on trust.

A rule that overstates its reach is worse than one that states its limits.

## The five it exempted, and one warning

Four are introspection over a map or a constant so a test can check it from
both directions — `ProductCsv::fields`, `StaffPresets::permissionsFor`,
`PlanLimits::assignedKeys`, `PlanLimits::billedKeys`.

The fifth, `Product::isLowStock`, is kept but now carries a warning in its own
docblock: it is a PHP copy of a rule that lives in SQL in three controllers,
and **it is branch-blind**. `InventoryController` compares against stock at one
branch; this compares against the shop total. A caller wanting the branch
answer would be told "fine" about a product that has run out where the customer
is standing.

## Gates

Backend **2048** green (+9) · pint clean · panel **902** green.
