---
name: shopos-plans-and-flow
description: FINAL billing model (2026-08-06 rebuild) — plans are payment-only; modules/branches/staff assigned per tenant at creation
metadata:
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-06T09:15:43.675Z
---

**2026-08-06 REBUILD — this supersedes every earlier billing design in this file, including the 2026-07-23 "flexible admin-configurable limit-based plans".**

The split the user chose:

- **Plan = what a business PAYS + billed usage.** price (PKR), billing period, grace days, and the ceilings that scale with consumption: `max_products`, `max_storage_mb`, `max_orders_month`. Nothing else. Columns **dropped** from `plans`: `features`, `online_shop_enabled`, `max_branches`, `max_staff`, `max_registers`. Added `is_custom`.
- **Tenant = what a business IS.** business type proposes → admin assigns **modules** directly at creation → admin assigns **branches / staff / registers**. Stored in `tenants.features` and `tenants.limits` (renamed from `limit_overrides`).

**Seeded ladder (PKR/month):** Basic 2,500 (1k products, 512MB, 7d grace) → Premium 6,000 (10k, 5GB, 14d) → Enterprise 15,000 (unlimited, 20GB, 30d). Plus `is_custom` bespoke plans, listed under the ladder. PlanSeeder retires the four old combo codes (finance-manager / business-pos / online-business / business-pos-online): deletes unused, deactivates in-use.

**Why (all three were real defects):**
1. Plans carrying a module map meant every combination needed its own plan — already 2³, doubling per new sellable module.
2. A **renewal** merged plan features over the tenant's and silently revoked modules an admin had granted one shop.
3. Trade modules (fuel, dine_in) couldn't sit on a plan without stripping the trades that need them.

**How to apply:**
- `PlanLimits::REGISTRY` declares an `owner` per key: `'plan'` (products, orders_month, storage_mb) or `'tenant'` (branches default 1, staff 5, registers 2). Resolution = `tenants.limits[key]` ?? plan column ?? platform default. Tenant-owned keys are **never** unlimited. `snapshot()` returns `owner`/`baseline`/`extra`/`assigned` (was `plan_limit`).
- `Tenant::applyModules()` is the ONLY way modules are written — normalises via `Modules::normalize()` (dependency graph + marketplace⇒images) and writes `online_shop_enabled` in the same call. That pairing was a live bug: ticking Online Store did nothing because `sellsOnline()` wants both.
- `Tenant::assignLimits()` is the only way limits are written.
- `AssignPlanAction` touches dates + the payment ledger **only**. Never features.
- `plan_id` is **required** on `POST /admin/tenants`; the request also takes `modules{}` and `limits{}`.
- `Modules::all()` now carries `group` + `depends`; `Modules::defaultsFor($type)` powers the create screen's proposal, exposed as `default_modules` on both `/business-types` and `TenantResource`.
- Gating everywhere (sidebar, routes, `EnsureFeature`) keys off `features` + `business_type`, never the plan — audited across backend and panel.

Tests: `tests/Feature/PlansAndModulesTest.php` (18) holds the contract. Suite **1082 green**; `migrate:fresh --seed` clean; panel tsc + build clean.

Demo world now demonstrates the model: MediPlus (Basic, delivery on / marketplace off), Highway Fuel + Sahil Tyre (Basic, trade modules intact), Karachi Books & Ledgers (Basic, expenses only — the case that used to need its own plan), Karahi House (custom plan).

---

**The 6-step revamp flow (still current, dependency order):** ① plans & limits ✅ ② business types → 5 + category ✅ ③ product create/list ✅ ④ multi-branch [[shopos-multi-branch]] ⑤ FOOD depth [[shopos-food-dinein]] ⑥ services directory, reports, offline POS [[shopos-offline-plan]], mobile.

Expense & Income module + cashbook shipped 2026-07-25 (income = manual non-sales money in; cashbook derives sales revenue from `sales.total`, never stores it in `incomes` — no double-count). Deepened 2026-08-06, see [[shopos-expense-manager-gaps]].

Related: [[shopos-build-sequence]] [[shopos-modules-jul31]] [[shopos-ui-conventions]]
