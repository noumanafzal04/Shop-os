---
name: shopos-petroleum-analysis
description: "Petroleum & Energy business type — gap analysis (ON HOLD): ~85-90% already covered; only Fuel Management is net-new; 'departments' = existing Branch dimension"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-30T14:50:59.533Z
---

**Petroleum & Energy** as a ShopOS business type — deep analysis done 2026-07-30, **build ON HOLD** (user: "keep hold for now"). It's a business *ecosystem*: fuel station + convenience mart + oil/lubricants + tyre shop + auto accessories + car wash + vehicle services, owner toggles only what they run.

**Verdict: ~85–90% of the platform already serves it. The ONE net-new subsystem is Fuel Management.** Verified against code (`app/Support/BusinessTypes.php`, `ItemTypes.php`, branch migrations, `CashSession`).

**Already built (reuse):**
- The doc's proposed "Business Units / `business_unit_id` / departments" architecture **already exists as ShopOS's Branch dimension** — see [[shopos-multi-branch]]. `branches`, `branch_stock`, `branch_prices`, `stock_transfers`, `users.branch_id` (staff pinned to a unit), `sales.branch_id` (correct decrement + restock), operating-branch context, HQ roll-up. So multi-department = solved.
- Mart / Accessories = 100% (retail POS). Oil = 100% (multi-unit + pack-breaking already do 250ml…20L). Car wash / vehicle service / tyre-fit are **sellable now** as `service` item-type lines (a `services` business type exists; examples include *Auto Workshop*).
- Customers/Suppliers/Purchases/Expenses/Reports/Staff/Roles/Settings all shared. Business-type + feature-flag toggles (`BusinessTypes::FEATURES` + `EnsureFeature`) make adding a `petroleum` type + `fuel` flag trivial.

**Architecture decision:** reuse **Branch AS Department** (Option A, ~zero cost, perfect for single-location station). Only add a parallel `department_id` (Option B) when a chain needs multiple stations × departments (branch is a flat single axis). Under A, confirm POS catalog is filtered to operating branch (likely already via Phase-4 scoped reads — not traced).

**Net-new = Fuel Management (0% exists):** fuel tanks + **tank/volume inventory** (dip readings, book-vs-dip reconciliation, shrinkage — reconciliation pattern mirrors `CashSession` expected/counted/variance), pumps + nozzles registry, meter/totalizer readings (liters = close−open per shift), tank refills/deliveries, **fuel POS mode** (rupee-amount→liters at a *daily-changing per-liter rate*, or meter delta), fuel-operator shift (extends CashSession + meter fields), fuel reports (liters, tank balance, dip recon, margin). Isolated — can be added later without touching the rest.

**Second (smaller) gap = Job Cards** for vehicle service (vehicle+reg, assigned technician, parts+labour, service history). Reservations ≠ job cards. Benefits ALL `services` businesses, not just petroleum.

Related: [[shopos-business-priority]] (FOOD/MART/MEDICAL are the daily-revenue-first types — petroleum is a later expansion), [[shopos-businessos-roadmap]].
