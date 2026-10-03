---
name: shopos-the-plan-ladder
description: Plans carry branches/staff/tills/bills/history/offline; null reads two ways; grace; a plan change never resets the meter
metadata:
  type: project
---

**2026-10-04.** The pricing model, settled.

    effective = (this shop's override OR the plan's included) + bought

**Null reads two ways on purpose.** UNLIMITED on billed usage (products,
storage, bills). "This plan has no opinion" on organisation size (branches,
staff, tills) — the shop then falls to the platform default 1 / 5 / 2, never
unlimited. That asymmetry is what made the migration safe: every pre-existing
plan holds null, so no shop's ceiling moved.

**Capability is never capacity.** A plan grants no modules. The one crossing
is offline selling, argued not assumed: a module describes the SHAPE of a
trade (a pharmacy has no kitchen docket); offline selling is wanted by every
trade and costs us money, so it is a rung. The offline HARD STOP stays with
the shop — that one is the owner's safety preference, not something sold.

**Grace, three words.** `reached` (at the figure) / `grace` (past it, inside
the allowance) / `over` (past that too). One word covered all three, so a shop
one bill over and one four thousand over read identically. Nothing ever
refuses a sale.

**A plan change is not a new month.** The meter counts live from the
subscription anniversary; the plan only moves the ceiling. 4,500 on Basic are
4,500 of Pro's 100,000.

Ladder: Basic 2,499 · Standard 4,999 (code is still `premium`) · Pro 7,999 ·
Enterprise 15,000. **Not deployed to live** — the user's call on 2026-10-04
was do not touch live; `PlanSeeder` would reprice real shops.

Related: [[shopos-archived-is-not-deleted]], [[shopos-admin-plan-model]].
