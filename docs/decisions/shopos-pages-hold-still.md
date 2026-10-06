# A page is cut from an order that cannot tie

**2026-10-06 · found by the QA journey, stage E (volume)**

## What happened

Two thousand products were imported from one CSV through the Import screen,
then read back a page at a time, a hundred to a page. **1,989 came back.**
Eleven products were on no page; eleven others were on two.

Nothing was lost. Every product was in the shop, sold at the till and could be
found by searching. They simply could not be reached with the Next button.

## Why

The list is sorted `ORDER BY created_at DESC`. An import creates all of its
rows inside the same second, so two thousand rows tie on the only column the
list is sorted by. A database is free to return tied rows in any order — and
free to choose a different order for the next query, which is what page two
is. Rows drift across the page boundary between requests.

It was not one list. **Forty-five paginated lists** were sorted by a date
alone: `sold_at`, `placed_at`, `opened_at`, `paid_at`, `created_at`. Sales
rung by two tills in the same second tie exactly the same way.

No test could see it. Fixtures are created one at a time, a millisecond
apart, and a small quiet table happens to come back in the same order twice.

## The rule

`->stably()` is the step immediately before every `->paginate()`.

- On an Eloquent query it appends the model's own key as the **last** ORDER
  BY. The order a person asked for still sorts first; the key only breaks
  ties. It does nothing if the key is already in the order, or if the query
  is grouped or distinct (there is no single row to break a tie with).
- On a query with no model behind it, it takes the column by name:
  `->stably('id')`. The ledger is five tables in a union. The first version
  of this fix forgot that and took the Ledger screen down — 20 tests said so.

`PagesHoldStillTest::test_no_list_is_paged_without_a_tiebreak` reads every
file under `app/` and fails on a `paginate(` that is not preceded by it.

## The test that could not fail

The obvious test was written first: 137 products created in one second, read
back in fourteen pages, counted. **It passed with the fix removed.** A
database that may order ties any way it likes may also order them the same
way twice, and on a small table it does.

It was deleted. The test that replaced it reads the SQL the five busiest
lists actually send (products, customers, suppliers, expenses, the ledger)
and requires the last ORDER BY term to be a unique key. Four mutations —
tiebreak removed from products, from expenses, from the ledger, and the macro
made to order nothing — each fail it.

The behaviour itself is proven where it was found: journey stage E walks all
twenty pages of the imported shelf and every page of 1,500 sales, and
requires each row exactly once.

## Also

The reorder list is capped at the two hundred items nearest to empty. With
three hundred items at nought the cap cut through a tie and kept a different
two hundred on every refresh. It now breaks the tie by key as well.
