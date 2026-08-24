---
name: shopos-branch-day-to-day
description: FIXED 2026-08-24 — staff can now be hired into a branch and are shown which one; gap 3 (branch name on more record screens) still open
metadata:
  type: project
---

The user asked how branches are handled day to day: switching, what data follows
the switch, how a branch manager knows where they are, how staff are created per
branch, and how an entry records which branch it happened in. **Mostly one
branch**, so none of it may block anything — but it must read correctly when a
shop does have two.

## What is already true (verified in the code, not assumed)

`ResolveBranch` middleware:

- **Owner** — `X-Branch-Id` focuses BOTH operations and reports on that branch.
  No header (or a stale one) = operations default to Main and reads span **all**
  branches: the HQ view. A foreign/other-tenant id is ignored, never fatal.
- **Staff** — pinned to `users.branch_id`, validated to this tenant. A header can
  never move them. Reads are always the one branch, never all.
- `BranchContext::scopesAll()` is what the read scoping keys on.

`BranchSwitcher` sits in the header, hidden for single-branch shops, labelled
"All branches" when nothing is chosen. A Branch column appears on
multi-branch shops in: sales, transfers, registers, stocktake (+ sheet), day,
till devices.

## The gaps — 1 and 2 FIXED 2026-08-24, see [[shopos-who-works-where]]

1. ~~**A staff member cannot be given a branch from the panel.**~~ FIXED.
   `StoreTenantStaffRequest` and `UpdateStaffRequest` both accept `branch_id`,
   and the staff screen never sends it — the word "branch" does not appear in
   `TenantStaffPage` or `useStaff` at all. So every staff member falls back to
   Main, and branch 2's manager rings on branch 1's stock. The server's whole
   staff-branch model is driven by a column nothing sets. Classic
   built-but-unreachable — see [[shopos-reachability-rule]].

2. ~~**A branch manager is never told which branch they are in.**~~ FIXED — read-only label in the header. `BranchSwitcher`
   returns null for staff (`role !== "shop_owner"`), and nothing else names the
   branch. They cannot be wrong about it — the server pins them — but they also
   cannot know.

3. ~~**Only 7 surfaces show a branch name**~~ FIXED — the four that STORE one (expenses, income, disposals, movements) now show it via one shared `useBranchColumn`. Purchase orders and the cashbook deliberately do not: neither table has the column.

   OLD TEXT: **only 7 surfaces show a branch name** out of ~65 tenant pages. Fine for
   most (a catalogue is shop-wide), but worth a pass for the ones that are
   branch-scoped records: expenses, cashbook/ledger, inventory movements,
   disposals, purchases.

## Related, already fixed

[[shopos-adjust-wrong-branch]] (hand adjustments always hit Main) and
[[shopos-forecourt-branch]] (panel-made tanks had branch_id null) were the same
family: a branch dimension the server had and one path ignored.
