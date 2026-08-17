# What is running out, turned into orders somebody can send

**2026-08-17.** The last of the three Aug-09 gaps but one.

## It was a half link, not a missing one

There WAS a button. "Order these 12 items" handed the whole list to Purchase
Orders as **one** pre-filled form: every item a line, **quantity 1**, priced at
the shop's own **blended cost**, with the **supplier left blank**.

So it saved the typing of names and nothing else — and it could only ever
produce one order.

## One order per SUPPLIER, and that is the whole design

The obvious version is wrong in a way that only shows up in a real shop. A
grocer's Monday reorder list holds twenty lines from **five** distributors, and
one purchase order containing all twenty is not an order anybody can send.

So the selection is grouped by who each item was last bought from, and one
draft is created per supplier. Five drafts, each sendable.

## Three things the form could not know

| | Was | Is |
|---|---|---|
| Supplier | blank | who it was **last bought from** |
| Price | the shop's blended stock cost | what was **last paid to that supplier** |
| Quantity | 1 | the shortfall against the shop's own reorder level |

### Why the supplier is derived and not stored

A product carries no `supplier_id`, and that is not an oversight to fix with a
column. **A grocer buys sugar from whoever was cheapest that week**, and a
chemist's distributor for one brand is not the distributor for the next. A
single "preferred supplier" field would be wrong within a month and would then
be wrong silently.

The shop's own purchase history knows perfectly well — every delivery already
records the supplier, the product and what was paid. **The answer was in the
database and nothing read it**, which is the shape this codebase keeps
producing.

### Last, not cheapest, not most frequent

"Cheapest ever" quotes a price nobody will honour today. "Most often" keeps
proposing the distributor the shop stopped using in March. The last delivery is
the one the buyer remembers and the relationship they currently have.

A **cancelled** order is not a relationship — it says what somebody intended
once and then thought better of — so it is excluded.

### The quantity is the shortfall and nothing cleverer

Enough to get back above the shop's own threshold. It is tempting to multiply —
order double, order a month's cover — but every one of those numbers would be
**invented here rather than chosen by the shop**, and an invented number on a
real order is a guess dressed as advice. The buyer knows their own turnover and
a draft is editable.

An item sitting exactly ON its threshold has a shortfall of zero, and orders 1:
it is on the list because the shop said this is the level at which it buys.

## Never placed, only drafted

Every quantity and price is a suggestion built from history. The one thing this
must never do is commit a shop to buying something.

## Items nobody has ever bought are named, not guessed

Putting one on somebody's order because they happened to be first in the list
would send a real order to a stranger. They come back named in the response, so
the screen says which need a supplier chosen by hand — and the reorder list now
carries a **"Never bought — pick a supplier by hand"** marker so a buyer knows
before pressing rather than after.

## Tests

`ReorderToPurchaseOrderTest`, 12 tests. The load-bearing one is not that it
makes an order — that is the easy half — but **`test_one_order_per_supplier`**.

Mutation-checked: collapsing the grouping fails 1 test and only that one;
counting cancelled orders as history fails exactly the assertion about it.

Related: [shopos-reorder-and-labels](shopos-reorder-and-labels.md), [shopos-moving-cost](shopos-moving-cost.md), [shopos-qa-sweep-aug09](shopos-qa-sweep-aug09.md).
