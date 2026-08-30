---
name: shopos-sizes-hold-the-stock
description: FIXED — adjusting a varianted PARENT said "Stock updated" and moved nothing; batch dialog never sent a size either
metadata:
  type: project
---

**Measured on the unfixed code**, shirt with S(5)+M(7), adjust parent +20:
`status 201 "Stock updated"` · `effectiveStock 12 → 12` ·
`products.stock_quantity 0 → 20`. The twenty went into the orphaned column that
`effectiveStock()` never reads. Till, catalogue and reorder list all unchanged.

Same hole through the **batch** dialog: it never sent `variant_id`, so a lot was
filed against the parent — the `product_batches` row existed and the size stayed
at zero.

**`StartStockCountAction` already stated the rule in a comment** ("A product
WITH variants holds no stock of its own"). Absent from the path a shopkeeper
presses. Same shape as [[shopos-promise-in-another-file]] and
[[shopos-half-a-rule]].

**Fix:** `InventoryService::adjust` refuses `VARIANT_REQUIRED` when the product
has variants and no size was named — in the SERVICE, so all 28 call sites are
covered by one check. Full suite stayed green ⇒ nothing legitimate relied on the
parent write.

**A refusal is only honest if the job can be done** ([[shopos-job-offered-must-be-doable]]):
parent Adjust hidden (each size row has its own), batch dialog has a REQUIRED
size picker (preselected when there is one size), every lot labelled with its
size, and the "currently N" line reads `catalogStock` not `stock_quantity`.

Server side was already fine — `ProductBatch.variant_id` end to end,
`PharmacyEdgeCasesTest` covers per-size lots. What was missing was a screen that
could send one.

**THIRD, and the sharpest.** `InventoryPage` draws a sub-row per size with an
unguarded `p.variants.map(...)`, and `GET /inventory/low-stock` loaded only
`category` — so `variants` was ABSENT and the reorder view would have gone
BLANK the moment the list had a sized row. Only ever seen empty, which is the
only reason nobody met it. TS can't catch it: `variants: ProductVariant[]` is
non-optional on the type and an unloaded relation is missing at runtime anyway.
`chrome.spec` walks that screen with no filter against an empty reorder list.
Fixed both halves + `e2e/reorder-view.spec.ts` (fails on pageerror).

**Side-effect to remember:** `shelf.setup.ts` topped up every product with a
PRODUCT-level adjust; for sized products that was a silent no-op and is now a
422, which shortened its own `stocked >= WANTED` count. The loop skips sized
products now. Adding a server-side refusal can break a FIXTURE that was relying
on the silent version.

