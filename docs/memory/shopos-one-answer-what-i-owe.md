---
name: shopos-one-answer-what-i-owe
description: FIXED — payables had three rules again; the Pay button over-allocated into short deliveries (Rs 5.3M on one shop)
metadata:
  type: project
---

2026-10-02, found by `loadtest:audit`. Naming the COLUMN once (`Payable::AMOUNT`)
was half the job — the RULE for netting it was still written three times.

**The case that separates them: pay the bill, the van is two cartons short.**

| reader | was | on one grocery |
|---|---|---|
| suppliers screen | per supplier, all payments, clamped | 61,623,805 |
| dashboard | **per ORDER**, clamped → credit thrown away | **65,998,037** |
| purchases report | per supplier, signed across all | 60,672,188 |

`Payable::owedByShop()` is the one rule: per supplier (money paid is money
paid, whichever docket), clamped **per supplier and never across them**. Paid
is read from `supplier_payments`, not `purchase_orders.amount_paid` — van cash
with no PO is real.

**Worse, and hiding behind the earlier fix:** `RecordSupplierPaymentAction`
computed `due` from `$po->total` in BOTH `refuseOverpayment` and
`applyOldestFirst`. `openOrdersFor` correctly excluded undelivered orders, then
the allocator overshot every SHORT one — Rs 5,325,848 across 24 orders, now 0.
`PurchaseOrder::syncPaymentStatus()` had the same bug: a fully-settled short
delivery read "partial" for ever, so the shop chases and pays again.

Tests: `OneAnswerToWhatIOweTest.php` (8 cases, pins all three readers to each
other; 2 mutations caught). Four existing tests repaired, not bulldozed — two
`DashboardMoneyOwedTest` fixtures wrote `amount_paid` with **no
`supplier_payments` row**, a state no code path can produce.

Related: [[shopos-pay-the-door-nobody-tested]], [[shopos-audit-every-figure-twice]]
