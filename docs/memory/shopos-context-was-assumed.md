---
name: shopos-context-was-assumed
description: "STANDING 2026-09-06: TenantContext/BranchContext were only ever SET, never cleared — so every rider-delivery test passed for the wrong reason; a write must take its tenant and branch from the ROW, not from ambient context"
metadata:
  type: project
---

**Found by writing edge cases, not by writing features.** Twenty-five refusal
tests around the rider flow ([[shopos-rider-side]]) exposed this; the happy path
never could.

## The bug

`CreateSaleAction` — which `OrderService::complete()` calls to write the Sale —
takes the tenant from `TenantContext` and the branch from `BranchContext`. That
is right for a till and for the panel, where the person pressing the button is
standing in the shop.

**A rider is not standing anywhere.** Their request resolves no tenant and no
branch, so a rider closing a delivery built a sale with a null tenant id.

It never failed a test because **a test reuses ONE container across requests**,
and `ResolveTenant` only ever `set()` the context — it never cleared it for a
customer, a rider or an admin. The shop owner's `assign-rider` call a moment
earlier left its tenant behind and the rider's call borrowed it. Every rider
delivery test was green **for the wrong reason**. Same family as
[[shopos-failed-check-is-not-a-verdict]] and [[shopos-detector-vs-rule]].

## The three fixes, each mutation-proven

1. **`ResolveTenant` CLEARS** for a role that owns no tenant. Production has a
   fresh container per request so nothing changes there — but a queue worker, an
   Octane process and the test suite all share one. *Empty because nobody set it
   is not a fence* — the same lesson as [[shopos-wall-between-shops]].
2. **`OrderService` runs place / complete / cancel as the ORDER'S shop**, taken
   from the row, and restores what was there afterwards. **Both sides or
   neither**: wrapping only `complete()` turned a symmetric wrong into an
   asymmetric one — the hold went to one branch and the release to another, and
   the sale then found nothing to take. That intermediate state was *worse* than
   the original bug.
3. **An order is finished at the branch that FILLED it** (`orders.branch_id`),
   never at whatever `BranchContext` holds. Same class as
   [[shopos-adjust-wrong-branch]] and [[shopos-forecourt-branch]]: a write
   taking its branch from ambient context instead of from the thing written.

Pinned by `test_an_order_is_finished_as_its_own_shop_at_its_own_branch`, shaped
like the accident: the second shop's owner acts, then the rider finishes the
first shop's order.

## The standing rule

**A write takes its tenant and its branch from the ROW, not from the request.**
Ambient context is an input for a person standing at a counter; it is not a
fact about the data.

Every path that writes tenant data from a request with no tenant stands on the
same assumption — a webhook, a queued job, a scheduled command, and now the
rider app. Check those before adding the next one.
