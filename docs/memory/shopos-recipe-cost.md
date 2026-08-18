---
name: shopos-recipe-cost
description: "A dish's unit_cost now comes from RecipeCost (its ingredients), not product.cost; unknown-is-not-zero; the depth cap was removed as a surviving mutation"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-17T09:52:56.512Z
---

**Shipped 2026-08-16** (audit item 19, found by reading the FOOD trade).

Every margin/profit/COGS figure is built from `sale_items.unit_cost`, which came
from `product.cost` — one hand-typed number. A cooked dish has no such number:
it costs chicken + onions + oil, which move violently here. So the Margins
report was computed perfectly from a figure nobody updates, **while every
ingredient of the real answer was already in the DB.**

`App\Support\RecipeCost::forDish()` → used by `CreateSaleAction::lineCost()`.

**Invariants not to break:**
- **Unknown is not zero.** One ingredient without a cost → `null`, never a
  partial sum. A part-costed dish looks more profitable than it is, which makes
  a kitchen underprice. Null falls back to `product.cost` (no regression) and
  the product form NAMES the missing ingredients.
- **Recipes nest** — a gravy base is real. A prepped item with an empty `cost`
  column is not reported as a gap.
- **The panel never computes it.** Cost prices are deliberately not sent to the
  browser (`HidesCostPrice`); the figure comes from `GET /products/{id}` as
  `recipe_cost` + `recipe_cost_missing`.
- **A sale line's `$source` can be a `ProductVariant`, not only a `Product`.**
  Only a Product can be a dish. Six pre-existing tests caught this.

**A surviving mutation, resolved:** the recursion had a depth cap AND a
visited-set; each terminates a cycle alone, so no test distinguished them. The
**cap was removed** — it silently answered "uncostable" for a legitimate
four-deep nest. Same call as M51. Don't reintroduce a depth cap.

Related: [[shopos-food-dinein]], [[shopos-stock-disposals]].
