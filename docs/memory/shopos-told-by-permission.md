---
name: shopos-told-by-permission
description: "2026-08-25 SHIPPED: operational notifications now go to whoever holds the permission to act (not owners only), scoped to the branch concerned. THE PERMISSION IS THE SETTING — no second switch."
metadata:
  type: project
---

Closes the question left open in [[shopos-everyone-minus-one-role]]: tenant
staff received **no operational notification of any kind**. `notifyTenantOwners`
filtered to owners by construction, so a stock keeper was never told a shelf ran
down and whoever packs orders was never told one arrived — while the bell
rendered for them and `/notifications` sat behind no role gate.

## The rule

**`notifyWhoCanAct(tenant, permission, …, atBranch)`** — whoever holds the
permission that lets them act. NOT a role: cashier/waiter/stock keeper are
permission SETS ([[shopos-no-roles]]), and a `notifyTheCashier` would put roles
back.

**THE PERMISSION IS THE SETTING.** That answers "should a cashier hear about low
stock?" without a new switch: a shop that doesn't want it doesn't tick
`inventory.manage`. A separate toggle would be a second answer to a question
already answered, and the two would drift.

Owners hold every permission implicitly → nothing taken from anybody.

**Branch-scoped** (`atBranch`): Gulberg's shelf tells Gulberg's people; an order
tells the branch filling it ([[shopos-nearest-branch-fills-it]]). Staff with
**no branch recorded are INCLUDED** — over-notify makes somebody ask, under-
notify makes nobody ask.

Four senders moved: low stock, near-expiry, order placed, reservation.
`notifyTenantOwners` then had zero callers → **deleted**, not left beside it.

## My mistake, caught by mutation

I wrote that the per-recipient dedupe suffix stopped one person silencing the
rest. Swapping it for a shared key passed all 6 tests: `app_notifications` is
already `unique(user_id, dedupe_key)`. The comment stated a rule the line does
not implement — [[shopos-promise-in-another-file]], written by me. Suffix kept
for continuity with existing rows; comment now says the true reason.

**Help Centre updated** — a shop must be told that ticking a box also decides
who gets alerted.
