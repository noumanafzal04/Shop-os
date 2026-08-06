# ShopOS — Build Roadmap

The destination is a **Multi-Tenant Commerce Operating System** (POS + Inventory +
Expense + Online + Marketplace) that any small/medium business — food, mart,
pharmacy, retail, services — runs on one codebase by enabling the modules it buys.

**Where we are:** the core (~70%) is built and tested (480 backend tests green).
This roadmap is the remaining ~30% + improvements, in build order.

**Guiding principles**
- Build the **5 verticals to "excellent," ship, then add modules** as paid upgrades. Don't build everything at once.
- **Two independent axes:** *Primary type (5)* = POS workflow · *Modules (POS/Expense/Online)* = what's purchased.
- One product model + JSON attributes/templates (no EAV). PKR-only (no currency/language). One primary business type + a category (no "secondary type").

**Status legend:** ✅ done · 🔶 in progress · ⬜ planned · ❓ needs a decision

---

## Phase 0 — Finish in-flight  🔶
**À-la-carte module billing** (POS / Expense / Online, any combination, per-module price, one shared renewal).
- ✅ `modules` + `tenant_modules` schema, `Module` model, seeder, `Tenant::modules()`
- 🔶 `SetTenantModulesAction` (derive features + renewal + itemized payment) + tests
- ⬜ Admin UI: module **checkboxes with per-module price + total** (replaces single-plan dropdown)
- ⬜ Tenant UI: nav default fix, "My Modules / Billing" page, dashboard adapts to active set
- **Effort:** ~3–4 days remaining.

## Phase 1 — Business-type consolidation (11 → 5)  ⬜
Five primary types by **POS workflow**: 🍔 Food · 🛒 Mart · 💊 Pharmacy · 🛍 Retail · 🛠 Services.
- Rewrite `BusinessTypes` registry to the 5; data migration mapping old 11 → 5.
- **Category within a type** (dependent dropdown): Retail → Electronics/Garments/Mobile…; drives default categories + **attribute templates** (RAM/CPU/Warranty, Size/Color…).
- Wholesale becomes a **bulk-pricing toggle**, not a type.
- **Effort:** ~2 days.

## Phase 2 — Finish FOOD (highest-value vertical gap)  ⬜
- **Recipe/BOM depletion** — a made-to-order dish depletes raw ingredients (mirror combo depletion).
- **Dine-in POS UI** — table grid → open tab → add items → Send to Kitchen → Settle/split. *(Backend already shipped.)*
- **Effort:** ~3–4 days.

## Phase 3 — Services directory (customer app)  ⬜
Service businesses listed under their shop name → browse by **location + price** → **Call** to contact (no online booking). Online module, adapted by business type.
- **Effort:** ~2 days.

## Phase 4 — Vertical field completeness  ⬜
- **Retail:** serial / IMEI number + warranty-per-unit (finishes the weakest vertical).
- **Pharmacy:** controlled-drug register + batch/expiry printed on the invoice.
- **Mart:** guided stocktake (count sheets → variance → adjustment).
- **Effort:** ~3–4 days.

## Phase 5 — Reports & exports (cross-vertical)  ⬜
Everyone needs an exportable day-close.
- CSV/PDF export; dead-stock, best/worst sellers, low-stock, inventory value, profit, cash flow.
- Reports in the tenant's timezone.
- **Effort:** ~2–3 days.

## Phase 6 — Offline POS  ⬜
The sale/stock contract is now settled, so this is safe to build.
- PWA shell → cached catalog → offline sales queue → background sync + conflict handling.
- **Effort:** ~1–2 weeks (the big one).

## Phase 7 — Multi-branch  ❓
Multiple branches per tenant (Head Office, DHA, Gulshan…), each with its own inventory/staff/sales/expenses; admin sees all, branch manager sees one.
- **Decision needed NOW** (cheap now, painful retrofit later): if branches are in the future, add a nullable `branch_id` (default "main branch") to inventory/sales/staff/expenses **as we touch those tables**, so the later build is free.
- **Effort:** ~1–2 weeks when built.

## Phase 8 — Growth modules (sell as paid add-ons)  ⬜
- **Loyalty / Wallet / Reward points / Gift cards** (customers)
- **HR** — attendance, salary, commission, leaves, shifts (staff)
- **Accounting** — ledgers, P&L, balance sheet
- **CRM + Marketing** — WhatsApp / SMS / email campaigns, support tickets
- **API access + Webhooks**
- **Effort:** each is its own module — build on demand.

## Phase 9 — Mobile apps  ⬜
Expo monorepo (with EAS + dev client), shared api/ui/types packages. Build order: **Customer → Rider → Owner**.
- **Effort:** ongoing, after web is solid.

---

## Decisions needed
1. **Multi-branch (Phase 7):** plan-for-it-now (drop nullable `branch_id` as we go) vs skip (single-location only)?
2. **Module pricing:** set real per-module prices now, or keep Rs 0 until launch?

## Recommended near-term order
Phase 0 (finish billing) → Phase 1 (5 types) → Phase 2 (FOOD) → Phase 3 (services) → Phase 5 (reports/exports) → Phase 4 (vertical polish) → Phase 6 (offline) → Phase 7+ (branches, growth, mobile).
