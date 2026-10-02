---
name: shopos-admin-plan-model
description: BACKLOG (user said "handle after") — admin plans/usage/add-ons model the user pasted 2026-10-02, and what our code already does vs the 6 real gaps
metadata:
  type: project
---

On 2026-10-02 the user pasted a market-level admin-side model (plans, usage,
add-ons, upgrade/downgrade, retention) and said **"we will handle this after
and check according to our System"**. Not a request to build — a direction to
check against. Checked read-only the same day.

**Its core rule is already ours.** `2026_08_06_000005_plans_are_billing_only`
split exactly the same way, for the same reasons written out in its docblock:
modules = WHAT (on the tenant), plans = HOW MUCH (ceilings). `PlanLimits::REGISTRY`
gives every limit an OWNER — `plan` for billed usage, `tenant` for organisation
size — and `tenants.limits` is the per-shop override, so no bespoke plan is
minted per customer. `plans.is_custom` keeps one-off deals off the public ladder.
Usage is counted LIVE from rows, never a stored counter, so "a plan change
changes the limit and never resets usage" falls out for free — there is no
counter to reset.

**The six real gaps** (none is a bug today; all are "not built yet"):

| # | Gap | Note |
|---|-----|------|
| ~~1~~ | ~~`orders_month` counts CANCELLED sales~~ **FIXED 2026-10-02** | `PlanLimits::usage()` filters only `created_at >= startOfMonth`. Training IS excluded (Sale's `not_training` global scope survives `withoutTenancy()`, which drops only `tenant`). A cancelled sale is a mistake, not usage. Smallest real fix of the six. |
| ~~2~~ | ~~Meter resets on the CALENDAR month~~ **FIXED 2026-10-03** — `PlanLimits::periodStart()`, the subscription anniversary walked in whole billing periods with `addMonthsNoOverflow` (plain `addMonths` takes 31 Jan to 3 MAR) | Billing period may start on the 12th. Theirs resets on the billing period. Ours is simpler; divergence is deliberate until someone is billed wrongly by it. |
| ~~3~~ | ~~No 80/90/100% warnings~~ **FIXED 2026-10-02** — `percent` + `band` (ok/nearing 80/critical 90/reached) on the server so both screens agree; grace still absent | `orders_month` and `storage_mb` are `enforced => false`, so there is no block AND no warning — a shop sails past its ceiling in silence. Warnings are the useful half, and they are missing. |
| ~~4~~ | ~~No add-ons as rows~~ **FIXED 2026-10-03** — `tenant_entitlements`: an add-on is capacity with a price, a temporary grant is capacity with an end date, a concession is neither. ONE table. Added on top of the assigned limit, so "assigned 10, plus 3 bought" survives | `tenants.limits` gives the EFFECT (12 users instead of 10) but not the REASON, so nothing can be invoiced or expire. Their "+2 users ×Rs X" is a row; ours is a number. |
| ~~5~~ | ~~No temporary / expiring grants~~ **FIXED 2026-10-03** — same table, `ends_on`. Dates not timestamps: "until 31 December" is in force THROUGH the 31st | "+5 users until 31 Dec" cannot be expressed. |
| 6 | Retention **recorded, not enforced** (2026-10-03) — `plans.retention_months` is shown in the catalogue and on the shop's page; nothing is hidden. Fencing the read is left OPEN on purpose: a shop that cannot find last March thinks its records are lost, not that its plan covers two years | Only hit for "retention\|archive" in app/ is RiderApplicationController. Their rule — archive ≠ delete, downgrade never deletes history — is one we have never had to break, because nothing archives. |

Their pricing numbers (Rs 2,499 / 4,999 / 7,999) are a starting commercial
structure, not a decision — see [[shopos-plans-and-flow]].

Transactions/month as the meter, not sales AMOUNT, is a rule we already follow.

**All six closed.** Five built; retention is recorded and visible with
enforcement deliberately left as a product decision — see
[[shopos-admin-plan-model]]'s row 6 and `docs/decisions/
shopos-capacity-and-the-shops-own-month.md`.

**Ending a grant ends it TODAY, inclusive — never deletes.** A grant that has
been billed cannot be made never to have existed.

Related: [[shopos-plans-and-flow]], [[shopos-modules-on-off]],
[[shopos-admin-side-backlog]], [[shopos-training-mode]].
