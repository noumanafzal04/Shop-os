# Matrices, and why coverage was the wrong question

**2026-08-31**

Two matrices, built after five bugs that a green suite of 2,387 tests had never
seen. Both encode an OUTCOME, not a path.

## The shape matrix

`ShapeMatrixTest` — 7 shapes × 4 stock paths × 2 addresses = **36 cells**.

Shapes: plain, sized, medicine, sized medicine, weighed, serialised, untracked.
Paths: adjust-in, adjust-set, batch-add, PO-receive.

**The invariant:**

> A path either succeeds and moves the shelf by exactly what was asked, or is
> refused with a reason and moves nothing.
>
> "Succeeded and moved nothing" is always a bug.

That is the sentence the sized-product bug lived inside: `201 Stock updated`,
and the shelf unchanged, because a product sold in sizes holds no stock of its
own and the twenty went into the parent's orphaned column.

The expected move is a property of the **shape**, not the path: five for
anything the shop counts, nought for anything it does not. `track_inventory`
off is not an exception carved out to make a test go green — it is what the
flag means.

### The third axis, and why the first version was useless

The matrix passed with the guard removed. It always addressed a sized product
**by its size**, so the failing shape — a caller naming the PARENT — was not in
it. Shape and path were not enough. Every sized shape now runs twice, aimed at
a size and aimed at the parent, and removing the guard produces eight failures
reading `answered 201, moved 0, expected 5`.

**A matrix can have the same blind spot as the tests it replaces.**

### What it found on its first run

`POST /inventory/products/{id}/batches` accepted a lot on a product that does
not track inventory: it filed a `product_batches` row saying it held five, then
skipped the stock write. `InventoryService::adjust` refuses that shape outright
(`PRODUCT_NOT_TRACKED`). Two doors, two answers. Now one.

## The money matrix

`MoneyMatrixTest` — five money paths across the supplier and customer ledgers.

**The invariant:** if a money path succeeds, the balance it names moves by
exactly the amount; if it is refused, nothing moves.

### Coverage was the wrong question

The first reading of the supplier-payment bug was "an untested branch": every
payment test sent `purchase_order_id`, so the door the screen uses — an amount
and a method — was never opened. A scanner was written to find optional fields
that every test supplies.

**It would not have found this one.** `CashMovementTest` had been posting a
payment with no order named since August. The branch was covered. That test
asserted the **drawer** — the cash out — and never once looked at what the
supplier was owed.

So the fault is not an unwalked path. It is:

> a path somebody walked, looking at the wrong thing on the other side.

No coverage tool can see that. Only an outcome can.

Mutation-proven against the real historical state — both halves reverted — the
matrix reports:

```
supplier · paid on account: answered 201, balance moved 0, expected -5000
```

It also showed the fix has two independent halves: allocation, and a balance
computed from the payments rather than from `purchase_orders.amount_paid`.
Breaking either alone leaves the balance correct.

## The scanner, kept for what it is

`scripts/untested-absence.py` — for every write endpoint, does any test omit
each optional field? It examines **458 (endpoint, field) pairs** and reports
**19** where every test supplies the field, plus **15 write routes no test posts
to at all**.

It does not catch the payment bug, and its docstring says so. It catches a
different, real thing: a fork in the road nobody has driven down.

Two notes on building it:

- The first version parsed `routes/api.php` by hand and missed the
  `Route::prefix(...)->group(...)` nesting, so `adjust` never matched
  `inventory/adjust`. Almost every join failed and it reported one finding with
  great confidence. It asks `php artisan route:list --json` now.
- `'email' => ['nullable', 'required_without:phone']` is not freely optional.
  Conditional-required rules are excluded, or the list teaches people to ignore
  it.

Sample of what it says, and each is a real shape:

- `POST /customers` — `phone` supplied by all 7 tests. A customer with no phone
  is real, and the till attaches a customer to a sale **by phone**, so that
  customer can never be sold to on khata.
- `POST /fuel/tanks` — `capacity_litres`, `current_dip_litres`,
  `dead_stock_litres` all always supplied.

## Two failures that were nobody's code

The suite went red on 31 August with two failures, and both were the calendar:
`now()->subMonths(74)` from the 31st clamps onto a 30-day month, so an age read
"6 yr 1 mo" instead of "6 yr 2 mo", and a payment landed in the neighbouring
month bucket. Proven by stashing every local change and watching them fail on
the committed code. Both tests pin the clock now.

**A date is an axis too.** These two were found by the calendar rolling over,
not by anybody testing for it.
