---
name: shopos-mirror-and-refusal
description: "2026-08-25 FIXED: a size's stock/price never reached the offline till (delta pages products.updated_at, InventoryService saves the VARIANT); and a refused offline sale vanished silently — money in the drawer, no sale, pill said Online"
metadata:
  type: project
---

Two offline defects, found from ONE order-dependent browser failure
(`Insufficient stock: only 0 in stock`, `retryable: false`). They compound: the
first sells what the shop hasn't got, the second hides the loss.

## 1. The mirror never learned

Offline catalog delta pages on `products.updated_at`. A size's stock is written
to the VARIANT — `InventoryService` saves `$target = $variant ?? $product` — so
selling the last Large moved `product_variants.updated_at` and left the parent,
the only row the delta looks at, alone. Same hole carried a size's PRICE.

**Fix: `ProductVariant::$touches = ['product']`** — one line.

**Two mistakes of mine worth not repeating:**
- I wrote TWO fixes (also `BranchStock::$touches`). Mutation showed either alone
  sufficed → shipped only the one that covers more. Don't ship an unproven fix.
- My branch-transfer test **passed against its own bug** — I asserted "the rollup
  doesn't change" but each `adjust()` changes it. Replaced with the size-price
  case. [[shopos-workflow-test-rule]] again, and it was mine this time.

## 2. The refusal nobody saw (worse)

`owedCount()` counts FAILED as *finished* — correct for "will we retry?", wrong
for "does a person need to act?". Refused rows were in NO count and nothing read
them. `markFailed`'s own comment says "nobody would ever know to look" — and
nothing looked.

Shop consequence: line drops → cashier rings a stale item → customer pays and
leaves → line returns → server refuses → row goes quiet → **pill reads
"Online"** → drawer closes OVER by that amount, cause unknowable.

`Reports → Offline` could never catch it: that screen asks the SERVER what
happened offline, and a refused sale never reached it.

**Fix:** `refusedRows()`/`refusedCount()`; `queueTally()` returns owed+refused
TOGETHER (3 call sites were 3 copies of one wiring); till shows a standing
non-dismissible red strip + "See which" (slip no, amount, the server's OWN
words). Unreadable amount says so, never "Rs 0". Drawn in BOTH panes —
[[shopos-offline-drawer-in-a-browser]].

**How to apply:** ask what a mirror was never TOLD had changed (sibling of
[[shopos-member-discount-offline]]); and one status answering two questions is
the `*.manage` shape — [[shopos-read-vs-manage]].

Related: [[shopos-the-machine-slept]] (same run), [[shopos-offline-plan]].
