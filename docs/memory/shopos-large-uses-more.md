---
name: shopos-large-uses-more
description: per-size recipes SHIPPED — RecipeFor is the one answer for 4 readers; size rows OVERRIDE (never add); e2e fixture shop is a MART so no food spec can ever run
metadata:
  type: project
---

Per-size recipes shipped 2026-08-24. Measured first, through the real API: a
sized dish with a `2 dough` recipe consumed **2 for the Small and 2 for the
Large**. Nothing refused, nothing logged — the feature was built one dimension
short of what it describes, and the food cost was wrong for every size but one.

**Why:** a size is what a kitchen scales. Same argument that put sizes into 86
([[shopos-large-ran-out]]) and into deals ([[shopos-which-pizza-in-the-deal]]).

**How to apply:**
- `App\Support\RecipeFor::rows(Product, ?ProductVariant)` is THE answer. Four
  readers: counter deduction, return restock, `bomSnapshot`, `RecipeCost`. The
  snapshot one matters most — it is what a refund restores, so without the size
  a returned Large put a Small's flour back.
- **OVERRIDE, not addition.** A size's rows replace the dish's rows. Addition
  cannot express the ordinary case: a Large uses MORE of the same flour, not
  extra flour on top of the Small's. A size naming nothing falls back to the
  dish's rows — which is what every existing recipe is.
- **Warned, not refused**, unlike the deal case. A deal with no size was
  UNSELLABLE (certain 422); a sized dish with one recipe still sells, it just
  deducts wrong. Refusing would break shops that did nothing wrong.
- `distinct` came off `recipe_items.*.ingredient_product_id` — same flour once
  per size is the commonest sized recipe. Pair (ingredient, size) is the unique
  key; `RECIPE_DUPLICATE` in the action. Second time `distinct` has had to go.
- The size select is **edit-only**: a variant still being typed has no id.

**I was wrong once here:** I read `OrderService` and was sure the online door
deducted no recipe at all. The probe showed it deducts at COMPLETION (rings
through `CreateSaleAction`); it only skips the placement-time HOLD. Don't
re-file that. See [[shopos-measurement-that-lied]].

**Standing gap — the e2e fixture shop is a MART.** `itemTypesFor('mart')` is
`["physical_product","deal"]`, so NO browser test can ever reach a food dish:
dine-in, KOT, menu hours and recipes are proven by backend tests only. A spec
that asks for a food dish skips forever and prints as a green line.
`e2e/skipReporter.ts` now names every skip that came from what the shop or
server said, separately from per-project skips. Fixing this needs a food
fixture shop.
