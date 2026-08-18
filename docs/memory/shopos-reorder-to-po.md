---
name: shopos-reorder-to-po
description: "Reorder list → purchase orders shipped 2026-08-17. ONE DRAFT PER SUPPLIER is the whole design. Supplier derived from purchase history, never stored on the product."
metadata:
  type: project
---

`docs/decisions/shopos-reorder-to-po.md`.

**It was a HALF link, not a missing one.** "Order these 12 items" pre-filled
ONE form: quantity 1, the shop's own blended cost, supplier blank. Saved the
typing of names and nothing else.

**One draft per SUPPLIER is the whole design.** A Monday reorder list holds
twenty lines from five distributors; one order containing all twenty is not an
order anybody can send.

**The supplier is DERIVED, never stored.** No `supplier_id` on products, and
that is correct — a grocer buys sugar from whoever was cheapest that week, so a
"preferred supplier" field is wrong within a month and wrong *silently*. The
purchase history already knew: `App\Support\LastBoughtFrom`.

- **Last**, not cheapest ("quotes a price nobody will honour today") and not
  most frequent ("keeps proposing the distributor they stopped using in March")
- A **cancelled** order is not a relationship
- Price = what was last **paid to that supplier**, not the shop's blended cost
- Quantity = the **shortfall**; multiplying would be a number invented here
  rather than chosen by the shop. Exactly-on-threshold orders 1
- **Draft, never placed**
- Never-bought items are **named, not guessed** — and the list marks them so a
  buyer knows before pressing

`POST /purchase-orders/from-reorder-list`, ids only (server decides supplier,
qty, price). `ReorderToPurchaseOrderTest` 12 tests, mutation-checked; the
load-bearing one is `test_one_order_per_supplier`.

**Last Aug-09 gap remaining: recurring income.**

Related: [[shopos-reorder-and-labels]], [[shopos-moving-cost]], [[shopos-expiry-alerts]].
