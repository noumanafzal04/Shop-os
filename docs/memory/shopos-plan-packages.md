---
name: shopos-plan-packages
description: DECIDED + BUILT 2026-10-09 — a plan carries a module list (starting point + label, NEVER the gate); modules shown by trade; add-on = any module past the plan, billed off the shop as it stands; no custom plan for an add-on
metadata:
  type: project
---

**The user asked (2026-10-09):** modules restricted by business type on admin
create/edit; choosing Basic should switch on what a small shop needs ("bs product
add kiye, label bnaye, POS ki"); extras shown separately as Add-ons; "plan k andr
modules set kr skty? ya manual assign?"; then: "basic plan + aik addon — plan
wohi rahy ga ya custom ban jaye ga?", "kaise pta chaly ga is sy extra charges
lene?", "custom plan bna k assign kryn gy ya auto ban jaye ga?"

**What was decided (my design, the user accepted it and asked for it built):**

- A plan carries a module list = what a shop STARTS with + the label "in the
  plan" vs "add-on". **`tenants.features` is still the only gate**, written
  only by `Tenant::applyModules()`. Nothing reads the plan list at request
  time, nothing ever switches a module off → the three August defects in
  [[shopos-plans-and-flow]] do not come back.
- Trade first: `ModulePackages::FOR_TRADE` (what a trade can use — generous),
  `ESSENTIAL` (what it cannot open without on any plan), `LADDER` (basic /
  premium="Standard" / pro / enterprise; each rung holds the one below).
- **The plan stays the plan.** An add-on never makes a custom plan — not by
  hand, not automatically. Custom plans are for a negotiated deal only.
- **An add-on is derived, not recorded**: any module the shop has that its plan
  does not include (`ModulePackages::standing` / `bill`). On the bill by being
  switched on; nothing to remember. Price = `module_addon_prices` (platform
  setting, Rs/month) or the shop's own `tenants.addon_prices` (0 = free).
  Yearly plan pays ×12.

**Where:** `backend/app/Support/ModulePackages.php`; migration
`2026_10_09_000001` (`plans.modules`, `tenants.addon_prices`); endpoints
`/admin/modules/offer`, `/admin/modules/prices`; `TenantResource.package`.
Panel: `admin/components/ModulePicker.tsx` (three bands, container-query grid),
create page, shop page (`BillCard`), plans page (tabbed dialog, checkboxes,
add-on prices), config page text.

**Bit me:** proposing through `Modules::normalize` PRUNES (dropped Labels because
Inventory was not listed) — use `Modules::settle([], …)` which pulls
dependencies in. A hook/test caught it, not me.

**Not done (said in the decision doc):** renewal dialog does not pre-fill plan +
add-ons; no pro-rating; server does not REFUSE a module outside a trade's list
(the journey and deliberate cross-trade grants need that) — the screen folds
them under "Not usual for this trade".

Related: [[shopos-queue-oct09]], [[shopos-plans-and-flow]]
