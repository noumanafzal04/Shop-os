---
name: shopos-adjust-wrong-branch
description: FIXED 2026-08-18 — hand stock adjustments always landed on Main regardless of the operated branch; BranchOperatingContextTest tested only the sale path
metadata:
  type: project
---

An owner who switched to their second branch and corrected stock had the
correction applied to **Main**. Two shelves wrong from one correct action, no
error. Fixed in `InventoryController::adjust` by passing `BranchContext::id()`
into `InventoryService::adjust` — resolved in the controller, never from the
body, because BranchContext already pins staff to their assignment.

**Why:** `InventoryService::adjust` read `$data['branch_id'] ?? $defaultBranchId`
and `AdjustStockRequest` has no `branch_id` rule, so it was always Main — while
the panel sends `X-Branch-Id` on every request. Receiving a lot, a stocktake, a
transfer and a sale all already resolved the operating branch; only the hand
adjustment did not.

**How to apply:** when several paths write to one thing, they must all answer
"where?" the same way — three out of four is a bug with three witnesses, not a
convention. Same shape as [[shopos-forecourt-branch]]. And note why the tests
missed it: `BranchOperatingContextTest` had four tests, all about the SALE path,
which was correct; the adjustment endpoint was never called. A test class with
the right name and the right fixtures can still never ask the question. See
[[shopos-qa-sweep]], [[shopos-multi-branch]].
