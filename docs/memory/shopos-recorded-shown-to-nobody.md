---
name: shopos-recorded-shown-to-nobody
description: "FIXED: a shift's offline violations were written to a column nothing reads; the offline report was sales-only and its clocks section was never rendered"
metadata:
  type: project
---

2026-09-02, found while closing C19 (the last always-supplied field).

`cash_sessions` had THREE columns written by the offline shift sync and read by
**nothing**: `pos_device_id`, `synced_at`, `offline_violations` — the migration
even added an index on `['tenant_id','synced_at']` for a query never written.

**Why:** `Reports → Offline` was built entirely out of SALES. A drawer opened,
used and counted with the line down appeared on **no screen in the product** —
violations and all. The sync controller and the migration both say the conflict
is recorded "for the owner to reconcile"; that is half a sentence unless a
screen says it.

The same screen was also missing `clocks` (which tablet needs its time set) —
backend built, documented and tested, absent from the panel's TypeScript, and
**already described to owners in the Help Centre**.

**Fixed:** `shifts` + `summary.shifts` + `summary.shifts_flagged` on
`GET /reports/offline`; a shifts section and a clocks section on the tab.
Practice shifts excluded (a training drawer holds no real money). Two smaller
repairs fell out: the empty state read "Nothing came in late" over a flagged
shift, and the "Need a decision" tile counted sales only.

**How to apply:** when a column is written, grep for its READERS before
believing the feature exists. `PosShiftSyncControllerTest` was green,
`OfflineReportTest` was green, the Help Centre had a paragraph — and the path
between them did not exist. Same class as [[shopos-promise-in-another-file]] and
[[shopos-sold-out-and-reachability]]; the honest check is
[[shopos-reachability-rule]] applied to COLUMNS, not just exports.

Also closed C19 itself: all 5 optional fields now have a test that omits them,
so `untested-absence.py` reads *every optional field omitted by at least one
test*. See [[shopos-absent-field-is-a-branch]].
