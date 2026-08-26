---
name: shopos-total-belonged-to-everyone
description: FIXED — expense/income totals were summed across EVERY tenant; getQuery() skips global scopes, toBase() applies them; one-tenant fixtures cannot see it
metadata:
  type: project
---

The Expenses screen showed **"1096 entries · Rs 4,678,156"** above its own list
of **178** bills. Income: 555 / Rs 452,268 above 65. Two counts of the same list
on the same screen.

`MoneyEntryFilters::totals()` did `(clone $query)->getQuery()`.
`Eloquent\Builder::getQuery()` returns the underlying query builder **before**
global scopes are applied — the `tenant` scope from `BelongsToTenant` among
them. `toBase()` is `applyScopes()->getQuery()` and is the one that fences.
The ROWS were always right, because `paginate()` goes through `toBase()`.

**Why ten green tests missed it:** every fixture had ONE tenant. With one
tenant, a scoped sum and an unscoped sum are the same number.

**Why:** it is a cross-tenant leak wearing the clothes of a rounding bug, and
the shape recurs anywhere a figure is computed by a different path from the
rows it sits above (aggregates, counts, exports, charts).

**How to apply:**
- In Eloquent, **`toBase()`, never `getQuery()`** — unless you specifically want
  the query without its scopes and can say why.
- Any test of a total/count/aggregate gets a **second tenant with more money
  than the first**. If the figure moves, the fence is missing.
- Assert the two figures on a screen against **each other**
  (`meta.pagination.total === meta.totals.count`), not against a literal — a
  literal passes on one tenant, the equality does not.

See [[shopos-measurement-that-lied]], [[shopos-half-a-rule]].
