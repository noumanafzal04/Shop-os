---
name: shopos-audit-aug06
description: "2026-08-06 audit + same-day fixes: all 6 findings closed (itemTypesFor template, serial fenced to retail, income missing from profit, expense edit, is_active inversion, dead endpoints); P2 list still open"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-06T18:19:40.045Z
---

Full write-up + fix record: `AUDIT-2026-08-06.md` at the repo root.

**ALL SIX FINDINGS BELOW ARE FIXED** (same day — backend 1229/5143 green, panel
102 green, +23/+7 tests). Kept because the *shapes* recur: each was a live
defect in a fully green build, found by reading code and reproduced by running
it, never inferred from a comment.

**Decision 2026-08-06 — NO service booking, ever.** A `services` business lists
what it does and its prices. `reservations` defaulting off for that type is the
right answer, not a placeholder.

**P0 (proven):**
- **F1 · `BusinessTypes::itemTypesFor()` reads the static TYPE TEMPLATE, not the
  tenant's module map.** So granting `products` to a `services`/`finance` tenant
  opens the route + sidebar + form and then 422s every save
  (`item_type: "This item type isn't available for your business type."`). Kills
  every per-tenant module upgrade the admin panel offers. The registry's own
  comment promises this path works, and `services` is even seeded a
  "Retail Products" category for items it can't create.
- **F2 · Serial/warranty is fenced to `retail` in the UI only.** POS + backend
  drive it off `product.tracks_serial` with no type gate; the product-form
  section and the sidebar item are both `businessType === "retail"`. The auto
  trade — batteries, the most warranty-claimed item in PK — can't reach it.
- **F3 · Income is absent from profit.** `DashboardService` contains "income"
  ZERO times; `ReportService::summary` does `revenue − cogs − expenses`.
  `cashbook()` gets it right. Same finance tenant, 300k in / 80k out:
  cashbook `net 220000` vs summary `net_profit −80000` vs dashboard
  `profit −80000`. The Reports page RENDERS that as its "Net" card for a
  books-only tenant → sign inverted on the headline screen of the only module
  they bought.

**P1:** F4 expense EDIT exists at route+tests+service+hook and `update` is never
destructured in ExpensesPage (income HAS the button — asymmetric); F5
`is_active` is honoured in the FILTER bar (wrong — hides history) and ignored in
all 3 entry forms + the backend (wrong — deactivation stops nothing); F6 five
endpoints with no panel caller: **Z-report (+print), `POST /shop/logo` (while
Settings has a live "Show logo" invoice toggle), waiter report, tables/reorder,
auth/sessions**.

**Method worth repeating:** dump `route:list --json`, regex every tenant route
against the whole panel source. 16/311 uncalled → 7 mobile-app (correct), 4
template-literal false positives, 5 real. Cheapest linkage check there is.

**Structural notes:** the TRADE axis is enforced in the PANEL ONLY (`itemTypesFor`
is the sole server-side type check); `auto_workshop` is a category under BOTH
`services` and `automotive` → same self-description, materially different
product; ShopSetupPage says "shop" 4× to a Finance Manager tenant.

**Coverage:** `finance` has NO dedicated suite (2 files touch it) — which is why
F3 survived the whole module build-out. Missing: books-only daily loop asserting
dashboard==summary==cashbook; a (type × granted-module) upgrade matrix.

Related: [[shopos-expense-manager-gaps]], [[shopos-audit-backlog]],
[[shopos-build-sequence]], [[shopos-retail-depth]], [[shopos-auto-depth]].

---

**HOW EACH WAS FIXED (2026-08-06):**
- **F1** → `itemTypesFor(string $code, ?array $features = null)`: tenant's own
  module map when there is one, template when there isn't (the picker has no
  tenant). Trade decides SHAPE (food_item/medicine), modules decide whether it
  stocks or bills. New `Tenant::moduleMap()`. `TenantResource` now publishes
  **`item_types`** and the product form reads THAT, not `/business-types` — one
  computation behind both the offer and the validation. `ModuleUpgradePathTest`.
- **F2** → `SERIAL_TRADES = [retail, automotive, petroleum]` + `tracksSerials()`
  in `common/tenant/businessType.ts`, read by BOTH the product form section and
  the sidebar item. Server never had a type gate.
- **F3** → `incomes` joined in `ReportService::summary` + `DashboardService`;
  `net_profit = revenue + other_income − cogs − expenses`; `other_income`
  published separately at both. Books-only KPI strip is now Money In / Spent /
  **Net Today**; Reports overview Money In / Money Out / Net; the chart plots
  money-in instead of a lone expense line. `BooksOnlyAgreementTest` asserts
  cashbook == summary == dashboard AND that a no-income month still shows the
  loss (guards against "fixed by adding a constant"). `KpiRow.test.tsx`.
- **F4** → `update` was destructured out of `useExpenseMutations` and dropped;
  now wired, plus new `updateRecurring`. One `active` handle carries form,
  errors and pending so add/edit can't drift.
- **F5** → both halves were inverted. Entry forms now DROP retired categories
  (keeping the one an edited row already sits under, or the select silently
  blanks); the filter bar KEEPS them as dashed chips (that is how history is
  reached). Server rejects a new-or-CHANGED assignment to an inactive category;
  unchanged always allowed. Shared `categoryOptions()`. `RetiredCategoryTest`.
- **Categories screen** → `/expense-categories` + `/income-categories` return
  **`entries_count` / `entries_total`** (withCount+withSum, new `expenses()` /
  `incomes()` relations). Row shows "47 expenses · Rs 480,000"; a used category
  draws **no Delete button** (the server would refuse — offering an action that
  always fails is worse than not offering it). Live and retired in SEPARATE
  lists. Real buttons, not three identical text links with Delete inches from
  Turn off. On/off is a state pill w/ status dot + aria-pressed. Turning off
  asks and says what stays true. Search past 8; "12 in use · 3 switched off".
- **F6** → Z-report `Print` on every counted shift in Day & banking (same
  `printHtmlDocument` iframe as receipts); logo upload appears under
  Settings→Receipt the moment "Show logo" is on; `TenantResource` publishes a
  resolved **`logo_url`** (never assemble storage URLs client-side).

**STILL OPEN:** P2 list (cash rounding ← most valuable, quick-keys, keypad,
warranty claim intake, relief cover, training mode); `auto_workshop` under both
`services` and `automotive`; shop-shaped setup copy for a finance tenant; 3 dead
endpoints (waiter report, tables/reorder, auth/sessions).

---

**P2 — first two shipped 2026-08-06** (backend 1241/5196, panel 102):

- **CASH ROUNDING.** `cash_rounding` setting (0/1/5/10, ships OFF),
  `App\Support\CashRounding`, `sales.rounding_adjustment` column. Design that
  makes it safe: **`total` never moves** (tax is computed on it — a settlement
  rule must never shift a tax figure); what rounds is the amount DUE IN CASH and
  the gap is stored separately. **Only a wholly-cash settlement rounds** — any
  card/credit/trade-in tender ⇒ exact. Ties go DOWN (customer's favour).
  **`DrawerMath` needed NO change**: it reads tendered − change, so putting
  rounding in "what is due" makes expected_cash follow for free. Key test: a
  correctly counted drawer reports variance **0**. Receipt prints Rounding +
  "To pay"; POS shows the rounded figure with the bill broken out.
- **NUMPAD.** `src/modules/pos/components/NumPad.tsx` + per-device `numPad` flag
  in `terminalStore` (beside the lane — keypad need is a hardware fact, not a
  user one). Drives cash tender AND the cart quantity box (decimals only for
  weight lines). Reason it mattered: these tills run on cheap Android tablets
  where the OS keyboard may never appear, and 1.250 kg at a 1 g step is 1,250
  taps on the stepper.
- Cleared 4 pre-existing `no-unused-vars` eslint errors in PosPage.

**P2 REMAINING:** quick-keys/favourites, warranty claim intake, relief cover,
customer display surface, training mode.

---

**P2 COMPLETE except relief cover + training mode (2026-08-06).**
Backend **1258**/5288 green, panel **102** green. **PUSHED:**
backend `f8ff1de..b5b5b8b` · panel `a6c0c5e..98dd9e3` · docs `8acd24d..f49b141`.

- **CUSTOMER DISPLAY = withdrawn, not built.** `HardwareDevice::TYPES` had
  `customer_display` and the panel built its picker from every key, so a
  merchant could register a peripheral nothing has ever rendered to — same shape
  as the "Show logo" toggle with no upload. `UNDRIVEN_TYPES` filters the picker;
  an already-saved row keeps its place badged "Not supported yet". **Principle:
  withholding a promise is a fix; building the second screen is a feature.**
- **QUICK KEYS.** `GET /pos/quick-keys`, DERIVED not curated (a favourites list
  somebody maintains is wrong in a month). **No-barcode items rank FIRST** —
  they're the whole reason the strip exists — then units sold, branch-scoped,
  30-day window. Reads 3× the slots so inactive items don't eat one. Strip hides
  once the cashier searches or picks a category. Cached 30 min.
- **WARRANTY CLAIMS.** `warranty_claims` table + `GET/POST /warranty/claims` +
  `/resolve`. **A claim is NOT a return** (no money, no stock, unit gone for
  days). `resolution === null` IS the open state (no status column to disagree).
  **Warranty snapshotted on intake, never recomputed** — the window closes
  before the supplier replies. Unknown serials CAN be booked in (other branch /
  pre-system). Resolve once only. `rejected` is a real outcome. Desk is now 2
  tabs: Look up (+ prior claims on that serial) and What we're holding (open
  first, oldest first).
- Gotchas hit: `BaseModel` needs BOTH `softDeletes()` and `updated_by` in the
  migration (HasAuditFields writes updated_by); `create()` doesn't hydrate
  un-named columns, so `->refresh()` before returning or a null `resolution`
  key is simply absent from the response.

**STILL OPEN:** relief cover, training mode (both features, both low priority
for a 1–3 person shop — training mode ranked last). Plus the 3 dead endpoints
(waiter report, tables/reorder, auth/sessions), `auto_workshop` under two types,
shop-shaped setup copy, `layaway_cancellation_fee_percent` orphan.
**Deployment/CI-CD remains the only hard launch blocker.**
