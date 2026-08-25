---
name: shopos-one-branch-runs-out
description: per-branch 86 SHIPPED — branch_sold_out table replaced the columns (ONE source of truth); online-door gap CLOSED 2026-08-25 by [[shopos-nearest-branch-fills-it]]; the silent press was found only in a browser
metadata:
  type: project
---

Per-branch sold-out shipped 2026-08-24, seven days after per-size. A chain had
ONE switch between its kitchens: Gulberg lost its bases, the chef took the pizza
off, and DHA — with a full tray — stopped selling it too.

Three dimensions now, each added after the one before proved a dimension short
of its own subject: product ("no pizza tonight") → size ([[shopos-large-ran-out]])
→ **branch**.

**How to apply:**
- `branch_sold_out` (branch, product, variant nullable) REPLACED
  `products.sold_out_at` / `product_variants.sold_out_at`. The columns are gone
  on purpose: keeping them as "off everywhere" beside per-branch rows is two
  places holding one fact. **The row's existence is the fact** — no
  `is_sold_out` column to drift.
- Existing flags were migrated to a row PER BRANCH, so nothing came back on sale
  during the deploy.
- `SoldOutController` uses the **operating** branch (`BranchContext::id()`),
  never `scopeId()` — same rule as receiving a delivery. All-branches view is
  asked, not guessed (`BRANCH_REQUIRED`).
- The dine-in tab asks the **ticket's** branch, not the operator's.
- `SoldOut::isOff(product, variant, branchId)`; null branch = "off anywhere",
  which is what headless paths and single-branch shops get.
- `PosProjection::item()` and `ProductController::stampBranchFigures()` both
  stamp per-branch state — the list and the till must not answer differently.

**The online door answers from MAIN, and that is a consequence not a design.**
Nothing on `orders` names a branch and `InventoryService` defaults to Main, so
that is the shelf it draws from. Measured before this: Main=0, Gulberg=10, an
online order for 2 → **422 "Insufficient stock: only 0 in stock"**. A refusal on
a full shelf one branch over. **STILL OPEN — needs a product decision** (nearest
branch / a chosen online branch / shop-wide pool).

**Found only in a browser:** an item with NO sizes opens no sheet, so the press
landed silently — a chef in a chain could not tell whether they closed their own
kitchen or the company. Backend's 24 tests were green. The server's reply
already carried the branch and nothing showed it. See
[[shopos-screens-nobody-opened]].

**Two caught before shipping:** the migration dropped a column while an index
still named it (the CI down-migration gate's exact shape), and `pint app/` was
run against the standing paths-only rule and reformatted 27 unrelated files.

Doc: `docs/decisions/shopos-one-branch-runs-out.md`.


## The online-door gap is CLOSED (2026-08-25)

`orders.branch_id` exists and an order is filled by **the nearest branch that
holds the whole basket** — see [[shopos-nearest-branch-fills-it]]. This file's
"answers from Main" is now history, not current behaviour.
