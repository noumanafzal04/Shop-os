# A report is not the whole shelf, and it has to say so

**Decided and shipped 2026-10-02.** Found by walking the panel against a
load-test shop with 569 stock lines instead of a dozen fixtures.

## The problem

Two reports — stock valuation and dead stock — were built as "send everything,
the screen will cope". The screen did not cope; it coped quietly, which is
worse:

```tsx
{(data?.items ?? []).slice(0, 100).map(...)}   // valuation
{(data?.items ?? []).slice(0, 200).map(...)}   // dead stock
```

So on that shop the server shipped **685 KB and 569 rows**, the browser drew
100 of them, and nothing anywhere said the other 469 existed. "Biggest
holdings" read as *the* holdings. An owner deciding what to stop buying was
looking at 18% of the shelf and had no way to know it.

The ninth instance this quarter of the same shape: **the API already supports
it, the screen never reads it.**

## The decision

Cap on the server, report the cap, and never cap the file.

```php
public const SCREEN_LINES = 200;

public function valuation(string $tenantId, ?string $branchId = null,
                          ?int $limit = self::SCREEN_LINES): array
```

Three rules, and all three had to hold together:

| | |
|---|---|
| **The rows** are capped at 200, biggest first | A page nobody scrolls to the end of is not a feature |
| **The totals** are over EVERY line | They are the figure the owner acts on; a total over 200 rows would be a different, wrong number |
| **The CSV** is not capped at all | `exportValuation` / `exportDeadStock` pass `limit: null` — what you hand an accountant is complete even when the screen is not |

The payload carries `items_shown` and `items_total`, and the panel's
`ShowingSome` draws one line underneath when they differ:

> Showing the top 200 of 569 lines. The totals above cover all of them, and
> Export CSV writes every one.

It renders **nothing** when every line is on screen, which is the second
failure mode and the opposite of the first: a shop whose whole shelf fits must
not be nagged about a cap it never hit.

## What this is not

It is not pagination. There is no page two, because nobody reads page two of a
valuation — they read the top of it and then they export. Low-stock, measured
at the same time, is a different case and still needs real pagination.

## Not fixed, and recorded as such

Valuation ~653 ms, dead stock ~670 ms. That is join cost, not an N+1, and an
index does not move it. The cap takes the transfer size down, not the query.

## Proof

`tests/Feature/AReportIsNotTheWholeShelfTest.php` (the server) and
`src/modules/expenses/components/StockReportTabs.test.tsx` (the line that
admits it). Both mutation-checked: forcing the notice to always render fails
the "says nothing when every line is on screen" case.
