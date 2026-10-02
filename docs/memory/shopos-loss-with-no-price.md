---
name: shopos-loss-with-no-price
description: FIXED — only a batch delete could create a disposal, so a non-batch shop could never value its shrinkage
metadata:
  type: project
---

2026-10-02. The Disposals module is ON by default for a mart and its screen
says "Stock that left without being sold — binned, or sent back for credit".
Its only writer was `DisposeBatchAction`, reached only by
`DELETE /batches/{batch}`. A mart, clothing, hardware or tyre shop batches
almost nothing, so that register was permanently empty for them.

The gap is **money, not stock**. Those shops could always do Inventory → Adjust
→ out, reason "Damaged" — and `stock_movements` **has no cost column at all**,
while `stock_disposals` carries `unit_cost`, `total_cost` and
`credit_expected`. So the year's shrinkage could not be totalled outside a
pharmacy.

Added `App\Actions\Inventory\WriteOffStockAction`, `POST /inventory/disposals`,
and a **Write off stock** control on the screen that already promised it
(`panel/src/modules/inventory/components/WriteOffModal.tsx` — the item is
TYPED, not picked from the shared dropdown, which drains ten pages and stops at
1,000 while these shops carry 6–10k).

Rules worth keeping: cost comes from `products.cost` (blended moving average),
a variant's own cost wins; **unknown stays NULL, never zero** — zero claims the
carton was free; a lot-tracked item is REFUSED
(`WRITE_OFF_IS_LOT_TRACKED`) because a disposal row carries one batch number
and one expiry, and picking a lot silently would make the pharmacist's figure
wrong undetectably.

Tests: `WhatTheBrokenCartonCostTest.php`, 9 cases; two mutations run and both
caught.

Related: [[shopos-stock-disposals]], [[shopos-four-doors]], [[shopos-moving-cost]]
