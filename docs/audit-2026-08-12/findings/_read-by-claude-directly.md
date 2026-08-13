# Read directly from code (not from .md docs) — 2026-08-12

Everything below was verified by opening the file. Where a suspicion was
**refuted**, that is recorded too — refuted items must not be re-raised.

---

## Verified WORKING (don't re-audit these)

### Combo/pack stock loss on cancel + return — CLOSED
The 2026-07-21 P0 is genuinely fixed, and fixed well.

`CancelSaleAction.php:47-83` no longer re-reads recipes. It reverses the sale's
own `stock_movements` (`reference_type='sale'`, `reference_id=$sale->id`,
`quantity_change<0`), turning each `out` into an `in` of the same amount, to the
same product/variant, **to the same branch**, with a per-movement idempotency
key (`cancel-mv-{id}`). Deleted or untracked products are skipped. Cancel is
refused when returns exist, so it can't collide with a partial return.

The comment explains the design: a combo's components can be edited after the
sale (`SyncComboItemsAction` full-replaces them), so replaying the live recipe
would restore the *wrong items*. The movements are the ground truth.

`ProcessSaleReturnAction` restores from a `components` snapshot stored on the
sale item, applies the pack `unit_factor`, and falls back to live combo/recipe
only when no snapshot exists.

### Trade / module / permission gating — strongest part of the system
`test/routes.ts` is a single source of truth for shop routes, asserted against
the sidebar, the dashboard tiles AND `screenPermissions`. The tests are real:

- `shopNavReach.test.ts` — **bidirectional**: no menu item without a route, and
  **no route orphaned** (every screen has some menu that offers it). This is the
  defence against "built but unreachable". Also asserts every business type gets
  a non-empty menu.
- `screenPermissions.test.ts` — *"names only permissions the server defines"*.
  The frontend↔backend permission diff is actually tested.
- `shopNav.test.ts` (375 lines) — every type × mode; books-only shop; POS-module
  screens; stock-module screens; each trade-specific screen.
- `presetSees.test.ts` — job presets, incl. "no preset is offered a screen in a
  trade that has no such module".
- `adminSees.test.ts` — admin rail per permission.

### Legacy business-type codes
`usePrimaryBusinessType()` reads `business_type_primary` (resolved server-side by
`BusinessTypes::primary`) with a fallback to the raw code for sessions persisted
before the field existed. Old `clinic` / `workshop` tenants keep their screens.

---

## REFUTED — do not re-raise

**"A restaurant using recipes will drive ingredient stock negative with no way to
restock, because food defaults `inventory: false`."**
FALSE. `SyncRecipeItemsAction::tracksStock()` (line ~140-149) checks
`$tenant->featureEnabled('inventory')`. With the module off, ingredients are
never auto-switched to `track_inventory`, so `CreateSaleAction.php:846` (which
requires `$ingredient->track_inventory`) never deducts them. No trap.

**"`/tenant/portfolio` and `/tenant/labels` are dead links in the sidebar."**
FALSE. Both are registered in `App.tsx` (`path="labels"` → `LabelsPage` at :214,
`path="portfolio"` → `PortfolioPage` at :242).

---

## OPEN — a live footgun (not yet fixed)

### `CreateProductAction` names its insert columns by hand
`CreateProductAction.php:51-102` builds the insert column-by-column, while
`UpdateProductAction` fills the model wholesale. Any field added to
`StoreProductRequest` but not added to that list is **accepted, validated, and
silently dropped on create** — then saves correctly on the next edit. It looks
like it works.

This already cost `drug_schedule` (controlled-drug marking blanked),
`tax_group_id` (item priced at the wrong rate) and `kitchen_station` (every dish
routed to the default station). Those three are fixed; the *shape* is not.

Fix direction: build the insert from a single field list shared with the request,
or add a test that diffs the request's rules against the columns actually written.

---

## OPEN — a design question, not a proven bug

`Suppliers` and `Purchases` live inside the `inventory` module in the sidebar
(`AppSidebar.tsx:185-202`). `food` defaults `inventory: false`, so a restaurant
gets no supplier directory and no purchase orders out of the box — yet it buys
ingredients daily. Its only route is to file them as Expenses.

Whether that is correct depends on whether restaurants are expected to have the
admin turn `inventory` on. Worth an explicit decision; not reported as a defect.

---

## Only 4 screens in the whole panel are trade-gated

Everything else is module-gated. From `AppSidebar.tsx`:

| Screen | Gate |
|---|---|
| Pharmacy | `inventory` && type === `pharmacy` |
| Vehicles | `products` && type ∈ {`automotive`, `petroleum`} |
| Warranty lookup | `pos` && `inventory` && type ∈ {`retail`,`automotive`,`petroleum`} |
| Portfolio | `services` && type === `services` |

Implication for the "is each trade complete?" question: **trade differentiation
lives almost entirely in the catalog fields and the POS behaviour, not in
separate screens.** So the real completeness answer depends on the product form
and the till — i.e. the `panel` audit area — far more than on the sidebar.

Notably absent for `automotive`: any job-card screen (vehicle in → work items →
parts + labour → out). Vehicles exists; a job card does not appear in the route
list. NOT yet verified by grep — flagged for the `automotive` audit batch.
