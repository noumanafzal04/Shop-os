# What is running low — one question, five places, two answers

**2026-08-29.** Reported from the shop floor: *"in inventory need reordering not
working"*.

## The bug

`ProductController` summed a product's SIZES before comparing. The **Needs
reordering** list — the screen a buyer actually orders from — read
`products.stock_quantity` instead. For anything sold in sizes that column is
what `Product::effectiveStock()` calls *an orphaned leftover that must not be
read as truth*: the stock is on the rows below and the parent keeps whatever it
was created with, which is nought.

```
0 <= low_stock_threshold
```

True for every threshold a shop could set. **A rail holding two hundred shirts
was on the reorder list every day, for ever.** A list that says everything says
nothing, and a trader stops opening it inside a week — so the feature was not
"a bit wrong", it was gone.

It hit precisely the trades built on sizes: retail (size/colour), pharmacy
(strength), a diner (portion).

## Proven before it was fixed

```
a shirt with 200 in stock was put on the list of things to buy
  — Failed asserting that an array does not contain 'Oxford Shirt'

catalogue: [Linen Shirt]
reorder  : [Linen Shirt, Oxford Shirt]
```

## Five places, and what each one was doing

| Where | What it did |
|---|---|
| Reorder list (`InventoryController::lowStock`) | read the parent column — every sized product, always |
| Dashboard count (`DashboardService::lowStockCount`) | both arms blind; the branch arm joined `whereNull('branch_stock.variant_id')`, which skips **exactly** the rows a sized product's stock lives on |
| Purchase order quantity (`DraftOrdersFromReorderList::shortfall`) | `threshold - 0` — three shirts short, ten ordered |
| Products table badge | "0 low" on a full rail |
| Inventory parent row | the same |

## The fix

**Server:** one `App\Support\LowStock` class. Three copies became one call. A
branch is a different SUM, not a different rule — `branch_stock` already holds
one row per size per branch, so summing it needs no variant arm.

**Panel:** the helper already existed. `catalogStock()` was written for the till
after a T-shirt with a full rail rendered out of stock and unpressable, and two
screens had hand-rolled a wrong copy beside it. **The failure was not a missing
helper, it was an ignored one.**

## Why nothing caught it

`scripts/one-rule-many-paths.py` tracks rules that raise an **error code**
(`TICKET_NOT_OPEN`, the discount ceiling). This rule is a **query predicate**,
so the whole bug class was outside the scanner's reach — it ran clean, honestly,
while blind to its own subject.

The new guard is `e2e/lowStockAsksOneRule.guard.ts`: no `.tsx` may compare a
product's `stock_quantity` against `low_stock_threshold`. A variant row is the
one exception — that row IS the stock. It has a denominator (150+ files) and
was mutation-proven:

```
FAIL  is never hand-rolled from stock_quantity on a product
  + "modules/catalog/pages/ProductsPage.tsx:383"
```

## Gates

Backend **2371/2371** · panel **1319/1319** · Playwright **257 passed, 0
failed** · QA sweep **1839 ok, 0 bugs**. Six new tests, mutation-proven both
ways: disabling the variant arm makes a genuinely-low shirt vanish from the
list, which is the failure the fix exists to prevent.
