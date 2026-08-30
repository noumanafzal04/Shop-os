---
name: shopos-pay-the-door-nobody-tested
description: FIXED — supplier Pay sent no purchase_order_id so it settled NOTHING; every payment test used the door the UI never opens
metadata:
  type: project
---

The Suppliers **Pay** button sends an amount and a method and nothing else — no
order picker exists on it. `RecordSupplierPaymentAction` filed the payment, took
the cash from the drawer, and applied it to **no order**, because
`outstanding = sum(po.total) − sum(po.amount_paid)` and `amount_paid` only moves
when a payment *names* an order. The figure never changed; a shopkeeper pays
twice.

**Why 2,373 green tests missed it:** every payment test passed
`purchase_order_id` (PurchasingTest, MartTenantWalkthroughTest ×3,
ReportsExpansionTest). The API had a door the UI does not use, and that was the
only door under test. See [[shopos-nested-resource-grep]] for the sibling
mistake — wrong instrument, confident answer.

**Now:**
- `App\Support\Payable` — one answer to "what is owed": **placed** orders only.
  A draft is a shopping list; it used to be counted as debt on the supplier row
  while the dashboard excluded it. Three readers, one rule.
- `outstanding` = placed totals − **ALL** payments (not `amount_paid`). Signed:
  negative is an **ADVANCE**, its own appended attribute. Paying a supplier with
  no orders is the commonest small-shop payment (`CashMovementTest` covered it
  since August) — refusing it would have been the easy consistency and wrong.
- On-account payments settle **oldest first**; `po_number` breaks same-day ties.
  ONE cash movement per payment however many orders it spans. A named order is
  still held to its own due. A draft/cancelled order → `PO_NOT_PAYABLE`.
- The dialog says what will be owed **after** the amount typed (`payMath.ts`,
  kept out of the component so it can be tested).

**Trap that cost a cycle:** `PurchaseOrder::$casts` casts `status` to the
`PurchaseStatus` enum, so `in_array($po->status, [...strings...], true)` matched
nothing and the draft guard passed everything.

Tests: `PaymentOnAccountTest` (9), all 7 originals failed on the unfixed code.
