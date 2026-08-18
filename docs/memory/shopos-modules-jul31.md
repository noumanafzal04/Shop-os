---
name: shopos-modules-jul31
description: "2026-07-31 module sprint — BOGO, petroleum type, inclusive tax + tax groups, customer groups SHIPPED (backend+tests); seeder --seed fixed; 3 pre-existing bugs fixed"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-07-31T10:17:14.881Z
---

**2026-07-31 sprint** — user directive: "finish the modules, offline + deployment LAST; also petroleum if easy (change label); test every edge case." Backend + tests done, panel UI + demo data added. Suite **695 green**. NOT yet committed/pushed (waiting for explicit ask).

**SHIPPED (backend + feature tests + demo-seed data):**
- **BOGO** — promotions `type='bogo'` (+ `buy_qty`/`get_qty`/`get_discount_pct` cols, migration `2026_07_31_000001`). `PromotionService::bogoDiscount()` = cheapest-units-free, whole-units only, effective per-unit price. Validation on Store/UpdatePromotionRequest (bogo needs buy/get, scope∈category/product, value auto-0). 11 tests in PromotionTest. Completes the promo engine (percent/fixed already done).
- **Petroleum business type** — `BusinessTypes.php` `petroleum` entry (products+services+inventory ON, marketplace/delivery OFF), UNITS(Litre…), VARIANT_ATTRIBUTES(Grade/Viscosity), categories(petrol_pump…). Fuel = a `sold_by='weight'` physical product (fractional litres); car wash/oil change = `service` items. Reuses Branch-as-department. Fuel Management (tanks/pumps/dip) still deferred — see [[shopos-petroleum-analysis]]. Tests: BusinessTypeEngineTest + new PetroleumEdgeCasesTest.
- **Inclusive tax + tax groups** — migration `2026_07_31_000002`: `tax_groups` table + `products.tax_group_id` + `sales.tax_inclusive`. Shop setting `tax_inclusive` (ShopSettings). `Product::effectiveTaxRate()` = group ?? own rate ?? shop default. CreateSaleAction: inclusive extracts tax-within (total NOT inflated); ProcessSaleReturnAction refunds sticker price without re-adding tax. `TaxGroup` model + CRUD (`/tax-groups`, products.manage). TaxTest (10).
- **Customer groups (tiered pricing)** — migration `2026_07_31_000003`: `customer_groups` (price_level retail|wholesale + discount_percent) + `customers.customer_group_id` + `sales.customer_group_id`. CreateSaleAction resolves linked customer's group up front → default line price level (explicit line still overrides) + auto members' discount (before loyalty). `CustomerGroup` model, `Customer::group()`, CRUD (`/customer-groups`, customers.manage), customer requests accept group. CustomerGroupTest (8).

**Seeder — `migrate:fresh --seed` now works** (user asked it always seed demo/test data). Fixes in DemoDataSeeder: builds a receive-map dating medicine lots (was tripping EXPIRY_REQUIRED); added `sold_by` passthrough; new **Highway Fuel Station** petroleum demo tenant; `seedMarketingExtras()` seeds a tax group, 2 customer groups, a percent promo + an (inactive) BOGO. Demo seeders already auto-run on local/testing (env-gated).

**3 PRE-EXISTING bugs fixed (verified on clean tree):**
1. `ReportService::purchases()` used raw `whereBetween('order_date',[from,to])` → date-cast column stores "…00:00:00" which sorts after bare "…-31", dropping orders ON the last day of any period. Fixed to startOfDay/endOfDay like every other report.
2. `ReceivePurchaseOrderAction` line ~130 unsafe `$row['batch_number']` access (undefined-key fatal on partial receive maps) → `?? null`.
3. Seeder medicine-expiry (above).

**ALSO SHIPPED later in the sprint (backend + tests):**
- **Serial-on-receive + per-serial returns** — migration `2026_07_31_000004`: `product_serials` registry (in_stock↔sold) + `sale_item_serials.returned_at`/`product_serial_id`. Receive captures in_stock serials (ReceivePurchaseOrderAction::registerSerials); sale marks matching registry row sold + links sale (legacy typed serials still work); cancel + per-serial return flip back to in_stock (return accepts `items.*.serials`). Guard now `whereNull('returned_at')` so returned serials resell. Endpoint `GET products/{product}/serials`. SerialInventoryTest (10).
- **Multi-branch money scoping** — migration `2026_07_31_000005`: `branch_id` on expenses/incomes/cash_sessions. Stamped from BranchContext on create (Expense/Income controllers + OpenCashSessionAction). Expense/income index + dashboard expenses now branch-scoped (removed the old "single-branch shows 0 expenses" hack). BranchMoneyScopingTest (4).

**DEFERRED — SMS/email receipts** (user 2026-07-31: "we will implement but comment the code for now — no credentials/keys yet"). `app/Actions/Sale/SendSaleReceiptAction.php` exists as a SCAFFOLD: composes the receipt text + logs intent, but the SMS (SmsSender) + email (Mail::raw) dispatch blocks are COMMENTED OUT and it's NOT wired to any route/auto-send. `SmsSender` already config-driven (dev-log when no gateway). To enable: set SMS_ENDPOINT/SMS_API_KEY/SMS_FROM + mail env, uncomment the blocks, add POST /sales/{sale}/send-receipt + optional `receipt_auto_send` setting + tests.

**Suite now 709 green** (before SMS scaffold, which adds no tests). Seed clean incl. petroleum tenant.

**PANEL UI shipped (tsc + `npm run build` green):**
- BOGO: PromotionsPage form — type "Buy X Get Y", buy/get/discount% fields, scope forced to category/product, table label; promotionsService + Draft extended.
- Customer groups: new customerGroupsService + useCustomerGroups; CustomersPage got a group `<Select>` on the add/edit form + a "Groups" manager modal (CRUD retail/wholesale + members' discount %).
- Tax: ShopSettingsPage Tax tab — `tax_inclusive` toggle + new `TaxGroupsManager` component (catalog module, list/create/edit/delete); ProductFormPage got a tax-group `<Select>` + own-rate input (group wins). New taxGroupsService + useTaxGroups.
- Branch money scoping: NO UI change needed — panel already sends `X-Branch-Id` (branchStore) on every request, so expense/income/dashboard/cash-session scoping works via the existing branch selector.

**Serial-capture UI SHIPPED** (user asked mid-sprint): PurchaseOrdersPage "Receive with details…" dialog (per-line qty + serial/IMEI entry for serialized goods + batch/expiry for medicines — also fixes the panel receiving medicine POs, which previously sent no expiry). POS serial modal shows in-stock serials as tap-to-fill chips (catalogService.serials → `GET /products/{id}/serials`). Backend PO `show` now eager-loads `items.product:id,tracks_serial,item_type`.

**COMMITTED + PUSHED** this sprint (user said "commit & push everything"): backend `backend` branch (ff4950d feature sprint, c806587 PO flags); panel `admin-panel` (22ba317 module UI, 68058a8 serial UI). NOTE: pushing triggers the GitHub Actions auto-deploy which is still BROKEN (frontend droplet lost .git + find-delete bug) — see [[shopos-deployment]]; so live site won't update until deployment is fixed.

**Then LAST:** offline PWA + deployment/CI-CD, then (when creds arrive) finish SMS/email receipts. Related: [[shopos-audit-backlog]], [[shopos-deployment]], [[shopos-payments-status]] (SMS/email same "no creds yet" pattern as gateways).
