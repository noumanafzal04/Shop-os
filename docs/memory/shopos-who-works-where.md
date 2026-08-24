---
name: shopos-who-works-where
description: FIXED — the panel never set users.branch_id, so every staff member fell back to Main and branch two's cashier rang on branch one's stock; nothing looked wrong
metadata:
  type: project
---

`ResolveBranch` pins a staff member to `users.branch_id`: a header can never move
them, their reads are that one branch, their sales draw down that branch's stock.
The whole staff-branch model runs on that column.

**The panel never once set it.** The word "branch" did not appear in
`TenantStaffPage`, `StaffPage` or `useStaff`. Every staff member in every
multi-branch shop fell back to Main.

> **The worst version of built-but-unreachable, because nothing looks wrong.**
> The server was right the entire time. No error, no empty state, no 403 — just a
> second branch quietly selling the first branch's stock, with reports that
> reconcile perfectly against the wrong site.

The Help Centre had been promising the behaviour the whole time — see
[[shopos-promise-in-another-file]].

**Three things were missing, not one:**

- the panel's own `User` type had no `branch_id`, so the server's field arrived
  and was dropped;
- the staff form had no control, and the list no column (both now appear ONLY
  where there is more than one branch — a single-site shop must not get a
  question with one answer);
- `BranchSwitcher` returned null for staff, so they could not be wrong about
  their branch and could not know it either. Read-only label now: **a switch the
  server ignores would be worse than silence.**

**Watch the update path.** `UpdateStaffAction` only calls `fill($data)`, so this
works exactly as long as `branch_id` stays in `User::$fillable` — silently
droppable for the entire life of the field. Removing it kills 3 of the 6 tests.

Tenant side only: the platform route marks `branch_id` **prohibited**, because a
platform staff member belongs to no shop. And an `exists` rule scoped to the
owner's tenant is what stops somebody being pinned to another shop's branch —
tested, not trusted.

Still open from [[shopos-branch-day-to-day]]: only 7 of ~65 tenant screens name a
branch; the branch-scoped RECORD screens (expenses, cashbook/ledger, movements,
disposals, purchases) are worth a pass.
