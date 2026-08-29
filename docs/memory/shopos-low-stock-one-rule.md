---
name: shopos-low-stock-one-rule
description: FIXED — "what is running low" was asked in 5 places and answered 2 ways; a rail of 200 shirts sat on the reorder list every day
metadata:
  type: project
---

Reported as *"in inventory need reordering not working"* (2026-08-29). Real, and
in **five** places.

The catalogue summed a product's SIZES. The reorder list, the dashboard count,
the purchase-order quantity and two table badges read `products.stock_quantity`
— which for a sized product is the orphaned nought. `0 <= threshold` holds
always, so **every sized product was on the buying list every day**, and the
order raised asked for a full threshold of stock already on the rail. It hit
exactly the trades built on sizes: retail, pharmacy, a diner.

Now `App\Support\LowStock` (server, one rule; a branch is a different SUM, not a
different rule) and the till's existing `catalogStock()` (panel). **The panel
helper already existed** — written after a T-shirt rendered unpressable — and
two screens had hand-rolled a wrong copy beside it. The failure was an IGNORED
helper, not a missing one; look for the helper before writing the comparison.

**Why no scanner caught it:** `one-rule-many-paths.py` tracks rules that raise an
ERROR CODE. This is a **query predicate**, so the class was outside its reach and
it ran clean while blind to its own subject. New axis:
`e2e/lowStockAsksOneRule.guard.ts` — no `.tsx` may compare a product's
`stock_quantity` against `low_stock_threshold` (a variant row is the one
exception; that row IS the stock). Denominator 150+ files, mutation-proven.

See [[shopos-detector-vs-rule]], [[shopos-promise-in-another-file]],
[[shopos-reorder-and-labels]], [[shopos-reorder-to-po]].
