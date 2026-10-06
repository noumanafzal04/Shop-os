---
name: shopos-pages-hold-still
description: STANDING — ->stably() before every paginate(); a sort on a date alone loses rows across pages; the "obvious" paging test cannot fail
metadata:
  type: feedback
---

**Rule:** `->stably()` is the step immediately before every `->paginate()` in the backend (`->stably('id')` on a base `DB::query()` — the ledger is a union with no model). It appends the model's key as the LAST order by. `PagesHoldStillTest` scans `app/` and fails on a paginate without it.

**Why:** 2026-10-06, journey stage E: 2,000 products imported from one CSV, paged back 100 at a time → 1,989 distinct. All rows share one `created_at` second, the only sort column; MySQL orders ties differently per query. 45 lists had it (sold_at, placed_at, opened_at…). No test saw it because fixtures are made a millisecond apart.

**How to apply:**
- New list endpoint → `->stably()->paginate(...)` on the same line or the guard fails.
- Do NOT prove paging with "make N rows in one second, walk the pages, count": that test PASSED with the fix removed (a small table returns ties in the same order twice). Assert the SQL instead — last ORDER BY term is a unique key — and mutate.
- The Eloquent macro does not exist on `Query\Builder`; forgetting that took the Ledger screen down (20 red tests).
- A capped list (`limit N`) sorted by a tying column has the same disease: reorder list fixed with `orderBy('products.id')`.

Related: [[shopos-page-two]], [[shopos-page-two-per-list]], [[shopos-workflow-test-rule]], [[shopos-the-journey]]
