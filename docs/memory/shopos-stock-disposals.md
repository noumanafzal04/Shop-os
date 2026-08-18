---
name: shopos-stock-disposals
description: "stock_disposals — written-off vs returned-to-supplier, never summed; expiry window is now per-trade (pharmacy 90d)"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-17T09:31:50.991Z
---

**Shipped 2026-08-16** (audit item 18, found by reading the PHARMACY trade —
the largest of the trade findings).

Removing a batch wrote ONE movement reading `"Batch X removed/expired"` covering
a write-off, a supplier return and a mis-keyed lot alike, then hard-deleted the
row and its `cost`. **No return-to-supplier concept existed anywhere.** And
`expiringWithin(30)` was hardcoded in three places while a distributor's return
window is 3–6 months — so the warning fired after the claim had closed.

`stock_disposals` + `DisposeBatchAction` + `/inventory/disposals`.

**Invariants not to break:**
- **A lot with stock cannot be removed without a disposition; an empty one can.**
  Read from the batch, not the request.
- **written_off and returned_to_supplier are NEVER summed.** One is a loss, the
  other is money about to come back.
- **Unknown cost stays null, not zero.** Counted but not valued.
- **A return does not post to the supplier ledger** — it is a claim.
  `credit_received` is what ARRIVED, never pre-filled from `credit_expected`.
- **Snapshots (`batch_number`, `expiry_date`, `unit_cost`) are deliberate** —
  the batch row is gone by the time anyone reads the disposal.
- **`ShopSettings::expiringSoonDays()` is ONE place**: pharmacy 90, others 30,
  tenant setting wins. The tile and the screen it opens must agree.

**A lead I checked and found FALSE — don't re-raise:** `destroy()` does NOT
double-deplete batches. `reference_type: 'batch'` sets `$batchScope = false` in
`InventoryService`, skipping both the expiry fence and the FEFO loop.

**Deliberately not built:** supplier-ledger posting; automatic return
suggestions (which lots a distributor accepts is a relationship, not a rule).

Full reasoning: `docs/decisions/shopos-stock-disposals.md`.

Related: [[shopos-pharmacy-edges]], [[shopos-business-priority]].
