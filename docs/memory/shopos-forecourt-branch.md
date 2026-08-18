---
name: shopos-forecourt-branch
description: FIXED 2026-08-18 — panel-created fuel tanks had branch_id null while the shift looked for Main, so no station could ever open a forecourt shift; 25 tests missed it
metadata:
  type: project
---

A petrol pump that set its forecourt up through the panel could **never open a
forecourt shift** — told "set up at least one tank and one nozzle" immediately
after doing exactly that, for ever. The whole fuel module was unreachable for
anyone using the shipped screen. Found by the QA sweep phase G; fixed with
`Branch::writeTargetId()` called from both `FuelSetupController` (tank + pump
create) and `OpenForecourtShiftAction`, plus a migration backfilling orphaned
rows.

**Why:** `branch_id` is nullable and `FuelSetupPage.tsx` does not send it.
Opening a shift resolved a missing branch to Main; creating a tank stored null.
Two halves answered the same question in opposite directions and never met.

**How to apply:** when a value is optional at the edge, **one** place decides
what its absence means — if two decide, they will decide differently and the
failure surfaces where neither is looking. And the reason `FuelManagementTest`'s
25 tests all passed: every fixture built its tank with `'branch_id' =>
$this->branchId()`, i.e. always supplied the field the real client omits. A
suite built that way cannot discover the field mattered. See [[shopos-qa-sweep]],
[[shopos-multi-branch]], [[shopos-unit11-status]].
