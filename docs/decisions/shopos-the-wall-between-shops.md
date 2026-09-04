# The wall between shops

**2026-09-05.** Found by the sweep's new isolation phase, on the first run it
ever made.

---

## What leaked

```
GET /api/v1/restaurant/tables/{another restaurant's table id}   → 200
```

One shop read another shop's floor plan — table name, seat count, and whatever
tab was open on it. And not only read: `update` and `destroy` on the same route
are bound the same way, so a shop could have **renamed or deleted the tables in
somebody else's restaurant.**

## Why

`BelongsToTenant` filters every query to the current tenant — **but only when a
tenant context exists.** Laravel's `SubstituteBindings` lives in the `api`
middleware group, so it ran **before** `ResolveTenant`. A route typed

```php
public function show(DiningTable $table)
```

resolved its model while the context was still empty, the global scope became a
no-op, and any shop's row bound by id.

## Why nobody had seen it

Because most controllers do not use binding. They do their own lookup:

```php
public function show(string $id)          //  CategoryController, SaleDocumentController,
{                                         //  ProductController, and most others
    return Model::query()->findOrFail($id);
}
```

That runs **inside** the stack, after the tenant is known, and refuses with 404
correctly. The two styles sit side by side in one folder, and the safe majority
made the whole surface look tested. Twenty-one methods across sixteen
controllers take a bound model.

## The fix

Ordering is the cause, so ordering is the fix:

```php
$middleware->prependToPriorityList(SubstituteBindings::class, ResolveTenant::class);
```

Nothing else changed. 2,530 backend tests pass either side of it.

## Mutation

Remove that one call:

```
✘ a shop cannot read another shop's dining table    → 200
✘ a shop cannot RENAME another shop's dining table  → 200
✘ a shop cannot DELETE another shop's dining table  → 200
```

`TenantWallTest` also asserts the OWNER still gets 200 for the same id. A wall
that refuses everybody is not a wall, it is a broken feature — and the cheapest
way to "fix" this bug would have been to break dine-in for its own shop.

---

## The part that is really about testing

Phase F had asked this question since the sweep was written. It asked it **five
times, between one pair of shops, about five kinds of record.** The sweep builds
nine shops and the API has forty-six kinds of record addressable by id. Five of
forty-six, across one of thirty-six possible pairs, is a sample so small that a
hole almost anywhere passes it — and one did, for as long as dine-in has
existed.

`phase_v` asks it **227 times across 147 (shop, record) pairs and 8 shops**, and
it needs no payload knowledge to do it: it reads each list endpoint **as its
owner**, takes the first id, and carries that id next door. It owns nothing and
creates nothing, so it grows on its own every time an earlier phase learns to
build something new.

### Two questions per record, and the second is the one shops mean

1. can the intruder **read it by id**? → must not be 200
2. does the intruder's **own list** contain it? → must not

The second is what people picture: not somebody guessing a UUID, but somebody's
customer simply *appearing* in your list. A scope missing from one query answers
(1) correctly and fails (2).

### And the mistake the phase made first

Its first version took "the next shop in the list" as the intruder. Eleven pairs
then answered **403** — the intruder's own `feature:` gate, fired long before
the tenant fence was consulted — and those printed as weak refusals when they
were **questions never asked**, on a run whose whole subject is telling those
two apart.

The neighbour is now *chosen*: the next shop that actually has the module the
record sits behind. Those eleven became real checks. Where no such shop exists —
only petroleum is given `fuel` — the pair is named as unasked rather than
counted as a pass.
