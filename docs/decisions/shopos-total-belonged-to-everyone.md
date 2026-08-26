# The total belonged to every shop at once

**2026-08-26 · shopos-backend · `app/Support/MoneyEntryFilters.php`**

## What a shop saw

The Expenses screen, over its own list of 178 bills:

```
1096 entries        Rs 4,678,156
…
178 expenses · page 1 of 12
```

Two counts of the same list, on the same screen, three hundred pixels apart.
Income said 555 / Rs 452,268 above 65 real entries.

## What it was

```php
public static function totals(Builder $query): array
{
    $scoped = (clone $query)->getQuery();   // ← here
    $scoped->orders = null;

    return [
        'count' => (int) (clone $scoped)->count(),
        'total' => round((float) (clone $scoped)->sum('amount'), 2),
    ];
}
```

`Eloquent\Builder::getQuery()` returns the underlying `Query\Builder` **as it
stands**. Global scopes have not been applied to it yet — `applyScopes()` is
what does that, and `toBase()` is `applyScopes()->getQuery()`.

`Expense` uses `BelongsToTenant`, which adds a global scope named `tenant`. So
the count and the sum were taken across every tenant in the database.

The rows were never wrong: `paginate()` goes through `toBase()`. Only the
figure printed above them.

## Why it survived

Two reasons, and they compound.

**It reads as a performance detail.** `getQuery()` and `toBase()` look
interchangeable at the call site — one word, no type change, no warning. The
docblock above it argued correctly about *which rows* the total should describe
("what the rows on screen add up to, not what the whole book adds up to") and
was silent about which *shop*.

**Every existing test had one tenant.** `MoneyEntryFiltersTest` created a
tenant, filed expenses under it, and asserted the total. With one tenant in the
database, an unscoped sum and a scoped sum are the same number. Ten tests
passed on a query that ignored the tenant fence entirely.

## The fix, and the assertion that keeps it

```php
$scoped = (clone $query)->toBase();
```

The test that matters is not "the total is 4900". It is:

```php
$this->assertSame(
    $body['meta']['pagination']['total'],
    $body['meta']['totals']['count'],
    'the bar and the pager must be counting the same book',
);
```

…with a second tenant holding far more on its books. Both figures on the screen
describe the same set of rows, and a scope that goes missing breaks the
equality rather than quietly inflating one side of it.

## The standing rule

**A test with one tenant cannot see a tenant bug.** Anywhere a figure is
computed by a path other than the one that fetched the rows — an aggregate, a
count, an export, a chart — put a second tenant in the fixture and give it more
money than the first. If the number moves, the fence is missing.

And in Eloquent: **`toBase()`, never `getQuery()`**, unless you specifically
want the query without its scopes and can say why.

Related: [[shopos-measurement-that-lied]], [[shopos-detector-vs-rule]].
